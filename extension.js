const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

let linkProviderDisposable = null;
let isLinkProviderEnabled = false;

function activate(context) {
    console.log('File Path Opener extension is now active!');

    enableDocumentLinks(context);

    let toggleDisposable = vscode.commands.registerCommand('file-path-opener.toggle', () => {
        if (isLinkProviderEnabled) {
            disableDocumentLinks();
            vscode.window.showInformationMessage('File Path Links: OFF (Alt+D still works)');
        } else {
            enableDocumentLinks(context);
            vscode.window.showInformationMessage('File Path Links: ON (Ctrl+Click enabled)');
        }
    });
    
    context.subscriptions.push(toggleDisposable);

    let disposable = vscode.commands.registerCommand('file-path-opener.openPath', async () => {
        const editor = vscode.window.activeTextEditor;
        
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        
        const line = document.lineAt(position.line);
        const lineText = line.text;
        
        let filePath = getFilePathAtPosition(lineText, position.character);
        
        if (!filePath) {
            vscode.window.showErrorMessage('No file path found at cursor position');
            return;
        }

        const fullPath = resolveFilePath(filePath, document.fileName);
        if (!fs.existsSync(fullPath)) {
            vscode.window.showErrorMessage(`File not found: ${fullPath}`);
            return;
        }

        try {
            const doc = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Opened: ${path.basename(fullPath)}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Error opening file: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

function getFilePathAtPosition(lineText, characterPos) {
    const patterns = [
        // src attributes
        /src=["']([^"']+\.[a-zA-Z0-9]+)["']/g,
        /src=\{([^}]+\.[a-zA-Z0-9]+)\}/g,
        // Any file with .md or .mdx extension
        /([^\s"'`()[\]{}]+\.mdx?)/g
    ];

    for (const pattern of patterns) {
        let match;
        pattern.lastIndex = 0;
        
        while ((match = pattern.exec(lineText)) !== null) {
            const filePath = match[1];
            const pathStartInMatch = match[0].indexOf(filePath);
            const pathStart = match.index + pathStartInMatch;
            const pathEnd = pathStart + filePath.length;
            
            if (characterPos >= pathStart && characterPos <= pathEnd) {
                return filePath;
            }
        }
    }
    
    return null;
}

function cleanPath(filePath) {
    return filePath
        .replace(/^["'`]/, '')
        .replace(/["'`]$/, '')
        .trim();
}

function resolveFilePath(filePath, documentPath) {
    const cleanedPath = cleanPath(filePath);
    
    // Fern snippets: /snippets/* -> find fern directory
    if (cleanedPath.startsWith('/snippets/')) {
        let currentDir = path.dirname(documentPath);
        while (currentDir !== path.dirname(currentDir)) {
            const fernPath = path.join(currentDir, 'fern');
            if (fs.existsSync(fernPath)) {
                return path.join(fernPath, cleanedPath.substring(1));
            }
            currentDir = path.dirname(currentDir);
        }
    }
    
    // Workspace absolute: /* -> workspace root
    if (cleanedPath.startsWith('/')) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, cleanedPath.substring(1));
        }
    }
    
    // System absolute or relative
    return path.isAbsolute(cleanedPath) ? cleanedPath : path.resolve(path.dirname(documentPath), cleanedPath);
}

function enableDocumentLinks(context) {
    if (linkProviderDisposable) {
        linkProviderDisposable.dispose();
    }
    
    linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
        { scheme: 'file' },
        new FilePathLinkProvider()
    );
    
    context.subscriptions.push(linkProviderDisposable);
    isLinkProviderEnabled = true;
    
}

function disableDocumentLinks() {
    if (linkProviderDisposable) {
        linkProviderDisposable.dispose();
        linkProviderDisposable = null;
    }
    isLinkProviderEnabled = false;
}

class FilePathLinkProvider {
    provideDocumentLinks(document, token) {
        const links = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            const patterns = [
                /src=["']([^"']+\.[a-zA-Z0-9]+)["']/g,
                /src=\{([^}]+\.[a-zA-Z0-9]+)\}/g,
                /([^\s"'`()[\]{}]+\.mdx?)/g
            ];

            for (const pattern of patterns) {
                let match;
                pattern.lastIndex = 0;
                
                while ((match = pattern.exec(line)) !== null) {
                    const filePath = match[1];
                    const pathStartInMatch = match[0].indexOf(filePath);
                    const startPos = match.index + pathStartInMatch;
                    const endPos = startPos + filePath.length;
                    
                    // Resolve the file path
                    const fullPath = resolveFilePath(filePath, document.fileName);
                    

                    if (!fs.existsSync(fullPath)) {
                        continue; // Skip if file doesn't exist
                    }
                    
                    const range = new vscode.Range(
                        new vscode.Position(lineIndex, startPos),
                        new vscode.Position(lineIndex, endPos)
                    );
                    
                    const link = new vscode.DocumentLink(
                        range, 
                        vscode.Uri.file(fullPath)
                    );
                    
                    links.push(link);
                }
            }
        }

        return links;
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};

