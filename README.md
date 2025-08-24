<p align="center">
  <img src="https://appstore.augmentos.org/app-icons/captions.png" alt="Captions Icon" width="240"/><br/>
  <strong style="font-size: 1.8em;">Live Captions for MentraOS</strong><br/>
  Real-time subtitles, right in your smart glasses.<br/>
  Bring conversations, meetings, and media to life with seamless live captioning on MentraOS
  <a href="https://apps.mentra.glass/package/com.augmentos.livecaptions"><br/><br/>
    <img src="https://img.shields.io/badge/Download-App%20Store-blue?style=for-the-badge" alt="Download"/>
  </a>
</p>
 

---

## 🚀 Development Guide

### Prerequisites
- [Docker](https://www.docker.com/products/docker-desktop)  
- [Bun](https://bun.sh/) *(optional, for local dev)*  

---

### 🐳 Docker Development (Recommended)

```bash
# Start the development environment
bun run docker:dev

# Start in detached mode
bun run docker:dev:detach

# View logs
bun run logs

# Stop the container
bun run docker:stop

# Rebuild the container
bun run docker:build
```

#### 🔗 Using Local SDK (Optional)  
If you’re hacking on both the app and SDK, the dev environment will auto-detect and use a local SDK from:  
- `../../../AugmentOS/augmentos_cloud/packages/sdk`  
- `../../AugmentOS/augmentos_cloud/packages/sdk`  
- `../../../augmentos_cloud/packages/sdk`  
- `../../augmentos_cloud/packages/sdk`  

---

### 💻 Local Development (Without Docker)

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

---

### 🛠 Common Tasks

```bash
# Add a new package
bun run add <package-name>

# Add a dev dependency
bun run add:dev <package-name>

# Remove a package
bun run remove <package-name>

# Run tests
bun run test

# Run linter
bun run lint

# Start a shell in the container
bun run sh
```

---

## 📜 License
See the [LICENSE](LICENSE) file for details.  
