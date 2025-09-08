# File Path Opener

A VS Code extension for opening files from docs.yml files and opening any src file, including Fern's markdown reusable snippet components.

## Features

- **Cmd+Click Navigation**: File paths appear underlined and can be opened with Cmd+Click
- **Smart Resolution**: Automatically resolves relative paths
- **Multiple File Types**: Supports .md, .mdx, images, PDFs, and other documentation assets

## Supported Path Formats

**docs.yml Files:**
- `summary: ../docs/api-reference.mdx`
- `path: "./guides/setup.md"`  
- `content: ../snippets/example.mdx`

**Fern Markdown Snippets & src Attributes:**
- `<Markdown src="../snippets/marketplace-url.mdx" />`
- `<img src="../assets/diagram.png">`
- `<embed src="./document.pdf">`
- `<Download src="../files/guide.pdf">`
- `src={../components/Button.mdx}`

## Usage

1. File paths appear underlined in YAML and MDX files
2. Hold `Cmd` (or `Ctrl` on Windows/Linux) and click any underlined path
3. The file opens in a new tab

**Toggle On/Off**: Use Command Palette → "Toggle File Path Links" to enable/disable

## Installation

### Development/Testing
1. Open this folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new window

### Permanent Installation
1. Package the extension: `npx @vscode/vsce package`
2. Install using one of these methods:

**Option A: Command Palette**
- Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
- Type: `Extensions: Install from VSIX`
- Select the generated `file-path-opener-1.0.0.vsix` file

**Option B: Command Line**
```bash
# Run from the extension directory:
code --install-extension file-path-opener-1.0.0.vsix

# Or from anywhere with full path:
code --install-extension /path/to/file-path-opener-1.0.0.vsix
```

## Use Cases

- **docs.yml navigation**: Click on file paths in YAML configuration files to open referenced markdown files
- **Fern markdown snippets**: Open reusable snippet components via `<Markdown src="..." />`
- **Asset references**: Navigate to images, PDFs, and other documentation assets
- **Component imports**: Jump to referenced MDX components and files

## Support

Found a bug or want to request a feature?

**[Open an issue on GitHub](https://github.com/fern-api/file-path-opener/issues)**

Please include an example of the file path that's not working and expected vs actual behavior
