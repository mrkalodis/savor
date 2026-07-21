'use strict';

const express = require('express');
const router = express.Router();
const settingsService = require('../services/settings-service');
const { getDb } = require('../database');

/**
 * POST /api/ai/chat
 * Communicate with the local AI model (Ollama) - STREAMING
 */
router.post('/api/ai/chat', async (req, res) => {
  try {
    const aiEnabled = settingsService.get(req.user.id, 'ai_enabled');
    
    if (aiEnabled !== '1') {
      return res.status(400).json({ error: 'AI Companion is disabled in settings.' });
    }

    const aiEndpoint = settingsService.get(req.user.id, 'ai_endpoint') || 'http://localhost:11434';
    const aiModel = settingsService.get(req.user.id, 'ai_model') || 'qwen2.5:0.5b';

    const { message, history = [], context } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    let systemContent = 'You are Savor AI, a helpful kitchen companion. You are running locally and have full access to the recipe context provided to you. If the user asks if you can see their recipe, always say YES and talk about it. Never say you do not have access or cannot see it.' +
      '\n\nAI BEHAVIOR RULES:\n' +
      '1. ALWAYS ASK SERVINGS: If the user asks you to generate, write, or create a recipe, you MUST first ask them how many people/servings they want the recipe for, unless they already specified the servings in their request. DO NOT generate the recipe until they provide the servings.\n' +
      '2. STRUCTURED RECIPE OUTPUT: When you generate a recipe, you MUST write the recipe using the exact key headers below so the system can parse it. Do NOT skip any headers, do NOT add conversational text before the Title, and you MUST always estimate and include numeric values for Servings, Prep Time, and Cook Time (e.g. write "Prep Time: 15" instead of "N/A" or "15 mins"):\n' +
      'Title: [Name of Recipe]\n' +
      'Description: [Brief description of the dish]\n' +
      'Servings: [Number of servings, e.g. 4]\n' +
      'Prep Time: [Minutes, e.g. 15]\n' +
      'Cook Time: [Minutes, e.g. 30]\n' +
      'Ingredients:\n- [First ingredient]\n- [Second ingredient]\n\n' +
      'Instructions:\n1. [First step]\n2. [Second step]\n\n' +
      '3. DETAILED STEPS: When writing the Instructions, be extremely detailed, thorough, and descriptive for each step. Provide specific cooking techniques, visual cues (e.g. "until golden brown and fragrant"), times, and temperatures where applicable. Never combine multiple major steps into one short line or skip details.';
    if (context) {
      systemContent += `\n\nCRITICAL CONTEXT: The user is currently viewing a recipe on their screen. You have full access to it. Here is the recipe text:\n${context}`;
    }

    const systemPrompt = {
      role: 'system',
      content: systemContent
    };

    const messages = [
      systemPrompt,
      ...history,
      { role: 'user', content: message }
    ];

    const response = await fetch(`${aiEndpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: aiModel,
        messages: messages,
        stream: true,
        options: {
          num_thread: 2
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ollama API Error:', errorText);
      return res.status(502).json({ error: 'Failed to communicate with AI model.' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const data = JSON.parse(line);
          if (data.message && data.message.content) {
            res.write(data.message.content);
          }
        } catch (e) {
          console.error('Error parsing NDJSON line:', e);
        }
      }
    }
    
    if (buffer.trim() !== '') {
      try {
        const data = JSON.parse(buffer);
        if (data.message && data.message.content) {
          res.write(data.message.content);
        }
      } catch (e) {}
    }

    res.end();
  } catch (error) {
    console.error('AI Route Error:', error);
    return res.status(500).json({ error: 'Internal server error processing AI request. Is Ollama running?' });
  }
});

/**
 * POST /api/ai/chats
 * Save a chat session
 */
router.post('/api/ai/chats', (req, res) => {
  try {
    const { id, title, history } = req.body;
    if (!history || history.length === 0) {
      return res.json({ success: true, id: id || null });
    }
    
    const db = getDb();
    const historyJson = JSON.stringify(history);
    const chatTitle = title || history[0]?.content?.substring(0, 50) || 'New Chat';

    if (id) {
      const stmt = db.prepare("UPDATE ai_chats SET title = ?, messages = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?");
      stmt.run(chatTitle, historyJson, id, req.user.id);
      return res.json({ success: true, id });
    } else {
      const stmt = db.prepare('INSERT INTO ai_chats (user_id, title, messages) VALUES (?, ?, ?)');
      const info = stmt.run(req.user.id, chatTitle, historyJson);
      return res.json({ success: true, id: info.lastInsertRowid });
    }
  } catch (err) {
    console.error('Error saving chat:', err);
    res.status(500).json({ error: 'Failed to save chat.' });
  }
});

/**
 * GET /api/ai/chats
 * List recent chats (within 7 days)
 */
router.get('/api/ai/chats', (req, res) => {
  try {
    const db = getDb();
    // Prune old chats
    db.prepare("DELETE FROM ai_chats WHERE user_id = ? AND updated_at < datetime('now', '-7 days')").run(req.user.id);
    
    const chats = db.prepare('SELECT id, title, updated_at FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    res.json(chats);
  } catch (err) {
    console.error('Error listing chats:', err);
    res.status(500).json({ error: 'Failed to list chats.' });
  }
});

/**
 * GET /api/ai/chats/:id
 * Get a specific chat
 */
router.get('/api/ai/chats/:id', (req, res) => {
  try {
    const db = getDb();
    const chat = db.prepare('SELECT * FROM ai_chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    chat.messages = JSON.parse(chat.messages);
    res.json(chat);
  } catch (err) {
    console.error('Error getting chat:', err);
    res.status(500).json({ error: 'Failed to get chat.' });
  }
});

/**
 * DELETE /api/ai/chats/:id
 */
router.delete('/api/ai/chats/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM ai_chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.redirect('/recent-chats');
  } catch (err) {
    console.error('Error deleting chat:', err);
    res.status(500).json({ error: 'Failed to delete chat.' });
  }
});

/**
 * GET /recent-chats
 * Render the recent chats view
 */
router.get('/recent-chats', async (req, res) => {
  try {
    const db = getDb();
    const collections = await require('../services/collection-service').getAllWithCounts(req.user.id);
    db.prepare("DELETE FROM ai_chats WHERE user_id = ? AND updated_at < datetime('now', '-7 days')").run(req.user.id);
    const chats = db.prepare("SELECT id, title, updated_at FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC").all(req.user.id);
    
    chats.forEach(c => {
      c.formattedDate = new Date(c.updated_at + 'Z').toLocaleString();
    });

    res.render('layouts/main', {
      title: 'Recent AI Chats',
      view: 'recent-chats',
      chats,
      collections
    });
  } catch (err) {
    console.error('Error rendering recent chats:', err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
