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

    let systemContent = 'You are Savor AI, a helpful, concise kitchen companion running locally on the user\'s server. Never claim to be created by OpenAI, Anthropic, or hosted on a cloud platform. If asked about your database access or hosting, state clearly that you run locally inside the Savor application and only have access to the information explicitly passed to you in the chat (like the current recipe context), with no direct access to the underlying server or databases.';
    if (context) {
      systemContent += `\n\nCRITICAL CONTEXT: The user is currently viewing a recipe on their screen. The system has extracted the text of this recipe and provided it to you below. If the user asks if you can see their recipe, say YES and tell them you can see it. Do NOT say you cannot see it. Here is the recipe they are looking at:\n${context}`;
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
