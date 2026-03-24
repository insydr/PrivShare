# PrivShare

**Zero-Trust Document Redaction & Collaboration Platform**

PrivShare is a web-based application that enables organizations to redact sensitive information from documents and share them securely without ever uploading the original sensitive data to a server. By leveraging **WebAssembly (Wasm)**, heavy computation (OCR, image processing, encryption) occurs entirely within the user's browser.

## 🏗️ Project Structure

```
privshare/
├── packages/
│   ├── client/                 # React 19 + Vite + TypeScript Frontend
│   │   ├── src/
│   │   │   ├── components/     # React UI components
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── workers/        # Web Workers for WASM execution
│   │   │   ├── utils/          # Utility functions
│   │   │   ├── store/          # Zustand state management
│   │   │   ├── types/          # TypeScript type definitions
│   │   │   ├── assets/         # Static assets
│   │   │   ├── styles/         # CSS styles
│   │   │   ├── App.tsx         # Main application component
│   │   │   └── main.tsx        # Application entry point
│   │   ├── public/
│   │   │   └── wasm/           # Compiled WASM modules
│   │   ├── index.html          # HTML template
│   │   ├── vite.config.ts      # Vite configuration
│   │   ├── tsconfig.json       # TypeScript configuration
│   │   └── package.json
│   │
│   ├── wasm-core/              # Rust WebAssembly Library
│   │   ├── src/
│   │   │   └── lib.rs          # WASM exports
│   │   └── Cargo.toml          # Rust dependencies
│   │
│   └── server/                 # Node.js + Express Backend
│       ├── src/
│       │   ├── routes/         # API routes
│       │   ├── middleware/     # Express middleware
│       │   ├── utils/          # Server utilities
│       │   └── index.ts        # Server entry point
│       ├── tsconfig.json
│       └── package.json
│
├── package.json                # Root package.json (npm workspaces)
├── tsconfig.json               # Root TypeScript configuration
└── README.md
```

## 🔐 Zero-Trust Architecture

**Core Principle: Files never leave the client device.**

### How It Works

1. **Local Processing**: All document processing (OCR, redaction, encryption) happens in the browser via WebAssembly
2. **No Server Storage**: The backend server only handles signaling (WebRTC handshake, WebSocket sync)
3. **Metadata Only**: Only redaction coordinates (JSON) are transmitted for collaboration
4. **P2P Sharing**: Final redacted files are shared directly via WebRTC peer-to-peer connections

### Security Enforcement

The server explicitly rejects:
- ❌ `multipart/form-data` (file uploads)
- ❌ `application/octet-stream` (binary data)
- ❌ Base64-encoded file content in JSON
- ❌ Large payloads (max 10KB for metadata)

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Rust** (latest stable)
- **wasm-pack** (`cargo install wasm-pack`)

### Installation

```bash
# Clone the repository
git clone https://github.com/privshare/privshare.git
cd privshare

# Install dependencies
npm install

# Build WASM module
npm run build:wasm

# Start development servers
npm run dev
```

### Development

```bash
# Start client only
npm run dev:client

# Start server only
npm run dev:server

# Start both
npm run dev
```

### Build for Production

```bash
npm run build
```

## 🛠️ Technology Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 19, Vite 5, TypeScript |
| **State Management** | Zustand |
| **WASM** | Rust, wasm-bindgen |
| **Backend** | Node.js, Express |
| **Real-time** | WebSocket, WebRTC |
| **Security** | Helmet, CSP, SRI |

## 📦 Packages

### @privshare/client

React 19 frontend with WebAssembly integration. Features include:
- Drag-and-drop file ingestion
- Canvas-based document rendering
- Real-time redaction preview
- Web Worker for WASM execution

### wasm-core

Rust library compiled to WebAssembly. Provides:
- OCR processing
- Image manipulation
- PII detection
- Hash generation

### @privshare/server

Signaling-only backend server:
- WebSocket for real-time collaboration
- WebRTC signaling
- Session management
- **NO FILE STORAGE**

## 🔒 Security Features

- **Content Security Policy (CSP)**: Strict script and resource loading
- **Subresource Integrity (SRI)**: WASM binary verification
- **Cross-Origin Headers**: COOP/COEP for SharedArrayBuffer
- **Input Validation**: Strict JSON-only payload limits

## 📝 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/sessions` | Create collaboration session |
| GET | `/api/sessions/:id` | Get session info |
| WS | `/ws` | WebSocket signaling |

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests for specific package
npm test --workspace=@privshare/client
```

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

**PrivShare** - Your files never leave your device. 🔐
