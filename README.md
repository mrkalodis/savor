# 🍽️ Savor — Self-Hosted Recipe Manager

Savor is a modern, mobile-optimized, and web-friendly recipe manager designed for self-hosting. It features multi-user support with strict tenant data isolation, an offline-capable Progressive Web App (PWA) experience, and a built-in local AI kitchen companion powered by Ollama.

---

## ✨ Features

- **🔒 Strict Multi-User Support**: Full user authentication. Each user gets their own sandboxed environment — recipes, collections, meal plans, shopping lists, and settings are completely private.
- **🤖 Local AI Companion**: Powered by Ollama (`qwen2.5:1.5b` by default) running directly inside your container. Ask for ingredient substitutions, kitchen conversions, or help with steps. Savor AI is context-aware and "sees" the recipe on your screen.
- **📥 One-Click Web Imports**: Paste a recipe URL to import the title, description, ingredients, instructions, cooking times, and images automatically using JSON-LD metadata parsing.
- **📱 Progressive Web App (PWA)**: Install Savor directly on your iOS, Android, or desktop home screen.
- **🔍 Fast FTS5 Search**: Instant search across all recipes using SQLite's Full-Text Search 5 engine.
- **📂 Collections & Reordering**: Organize recipes in collections with custom color badges. Reorder items using a smooth drag-and-drop interface.
- **💾 Full Backups**: Create and restore self-contained `.tar.gz` backups containing your database and recipe images.

---

## 🚀 Proxmox VE LXC Deployment

Savor is optimized to run as a Proxmox VE Linux Container (LXC) on an Ubuntu 24.04 base image.

### System Requirements (LXC)
- **OS**: Ubuntu 24.04
- **CPU**: 2 Cores (recommended for local AI inference)
- **RAM**: 2048 MB (2GB - provides headroom for the local Qwen model)
- **Disk**: 8 GB (SSD recommended)

### One-Command Installer
Open the Proxmox VE web console, click on your Proxmox Node, open the **Shell**, and run:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/community-scripts/savor/main/proxmox/ct/savor.sh)"
```

*Note: If you fork this repository to customize it, make sure to replace the GitHub repository URLs in `proxmox/ct/savor.sh` and `proxmox/install/savor-install.sh` with your own URL before running.*

---

## 🔑 Default Credentials

### Web Application Login
Navigate to `http://<YOUR_CONTAINER_IP>:3000` and log in:
- **Email**: `admin@local`
- **Password**: `recipe`

### LXC Container Console Login
If logging directly into the container terminal via Proxmox GUI:
- **Username**: `root`
- **Password**: `recipe`

> [!IMPORTANT]
> For security, navigate to the **Settings** panel in the web app to change the default password, and run `passwd` in the container console to update the root password.

---

## 🛠️ Local Development Setup

If you want to run Savor locally for development:

### Prerequisites
- Node.js 20 LTS or higher
- [Ollama](https://ollama.com/) (running on your machine)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/community-scripts/savor.git
   cd savor
   ```
2. Install npm packages:
   ```bash
   npm install
   ```
3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   npm start
   ```

The application will be running at [http://localhost:3000](http://localhost:3000).

---

## 📂 Project Structure

```text
├── data/                  # SQLite database, images, and backups (mounted/saved here)
├── proxmox/               # Proxmox VE LXC installation files
│   ├── ct/savor.sh        # LXC container creation script
│   ├── install/           # In-container installer scripts
│   └── json/savor.json    # Community script manifest definition
├── public/                # Static assets (CSS design system, JS, PWA icons, SW)
├── src/
│   ├── middleware/        # Authentication & security middleware
│   ├── routes/            # Route controllers (Express routing)
│   ├── services/          # Business logic layers (recipes, collections, settings, AI, backups)
│   ├── utils/             # Helper utilities (time parsing, sanitization)
│   └── database.js        # SQLite DB connection lifecycle & schema migrations
├── views/                 # EJS Layouts and partial templates
├── server.js              # Express app bootstrap & HTTP/WS server initialization
└── README.md              # Project documentation
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/community-scripts/savor/issues).

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
