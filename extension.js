const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const yaml = require('yaml');
const kebabCase = require('lodash.kebabcase');

let linkProviderDisposable = null;
let isLinkProviderEnabled = false;

// Slug annotation state
let slugDecorationType = null;
let slugUpdateTimeout = null;

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

    // Initialize slug annotations
    initSlugAnnotations(context);
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
                    
                    const fullPath = resolveFilePath(filePath, document.fileName);

                    if (!fs.existsSync(fullPath)) {
                        continue;
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

// ============================================================================
// Slug Annotation Feature
//
// Shows ghost text next to "path:" values in docs.yml / product yml files,
// displaying the auto-generated URL slug for each page. This mirrors the
// slug generation logic from the Fern platform's SlugGenerator.
// ============================================================================

// kebabCase is provided by lodash.kebabcase (same implementation used by Fern CLI)

/**
 * Initialize slug annotation decorations and event listeners.
 */
function initSlugAnnotations(context) {
    slugDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorGhostText.foreground'),
            fontStyle: 'italic',
            margin: '0 0 0 2em',
        },
        isWholeLine: false,
    });

    context.subscriptions.push(slugDecorationType);

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            triggerSlugUpdate(editor);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            triggerSlugUpdate(editor);
        }
    }, null, context.subscriptions);

    if (vscode.window.activeTextEditor) {
        triggerSlugUpdate(vscode.window.activeTextEditor);
    }
}

/**
 * Debounced trigger for updating slug decorations.
 */
function triggerSlugUpdate(editor) {
    if (slugUpdateTimeout) {
        clearTimeout(slugUpdateTimeout);
    }
    slugUpdateTimeout = setTimeout(() => updateSlugDecorations(editor), 300);
}

/**
 * Main function to compute and display slug annotations.
 */
function updateSlugDecorations(editor) {
    if (!editor || !slugDecorationType) return;

    const document = editor.document;
    const fileName = path.basename(document.fileName);

    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
        editor.setDecorations(slugDecorationType, []);
        return;
    }

    try {
        const text = document.getText();
        const parsed = yaml.parse(text);

        if (!parsed) {
            editor.setDecorations(slugDecorationType, []);
            return;
        }

        const slugMap = computeSlugMap(parsed, document.fileName);
        const decorations = buildSlugDecorations(document, slugMap);
        editor.setDecorations(slugDecorationType, decorations);
    } catch (e) {
        // YAML parse errors are expected while editing; silently clear decorations
        editor.setDecorations(slugDecorationType, []);
    }
}

/**
 * Compute a map from path string -> slug string by walking the navigation tree.
 */
function computeSlugMap(parsed, filePath) {
    const slugMap = new Map();

    let productSlug = '';

    if (parsed.navigation || parsed.tabs) {
        const rootInfo = findRootDocsYml(filePath);
        if (rootInfo) {
            productSlug = getProductSlug(rootInfo, filePath) || '';
        }
    }

    const parentParts = productSlug ? [productSlug] : [];

    if (parsed.navigation) {
        walkNavigation(parsed.navigation, parentParts, slugMap);
    }

    if (parsed.tabs) {
        walkTabs(parsed.tabs, parentParts, slugMap);
    }

    return slugMap;
}

/**
 * Walk navigation items recursively, computing slugs for each page.
 *
 * Slug logic mirrors the Fern platform's SlugGenerator:
 *   urlSlug = item.slug ?? kebabCase(item.title)
 *   fullSlug = parentParts.join('/') + '/' + urlSlug
 */
function walkNavigation(items, parentParts, slugMap) {
    if (!Array.isArray(items)) return;

    for (const item of items) {
        if (item === null || typeof item !== 'object') continue;

        // Page: has "page" (title) and "path" (file reference)
        if (item.page && item.path) {
            const urlSlug = item.slug || kebabCase(item.page);
            const parts = [...parentParts, urlSlug];
            const slug = parts.filter(Boolean).join('/');
            slugMap.set(item.path, slug);
        }

        // Section: has "section" (title) and "contents" (children)
        if (item.section && item.contents) {
            let sectionParts;
            if (item['skip-slug']) {
                sectionParts = [...parentParts];
            } else {
                const urlSlug = item.slug || kebabCase(item.section);
                sectionParts = [...parentParts, urlSlug];
            }
            walkNavigation(item.contents, sectionParts, slugMap);
        }

        // API reference with layout containing pages
        if (item.api !== undefined && item.layout) {
            const apiName = typeof item.api === 'string' ? item.api : '';
            const urlSlug = item.slug || kebabCase(apiName);
            const apiParts = [...parentParts, urlSlug];
            walkNavigation(item.layout, apiParts, slugMap);
        }
    }
}

/**
 * Walk tabbed navigation structure.
 */
function walkTabs(tabs, parentParts, slugMap) {
    if (!Array.isArray(tabs)) return;

    for (const tab of tabs) {
        if (!tab || typeof tab !== 'object') continue;

        if (tab.tab && (tab.layout || tab.contents)) {
            const urlSlug = tab.slug || kebabCase(tab.tab);
            const tabParts = tab['skip-slug'] ? [...parentParts] : [...parentParts, urlSlug];
            const children = tab.layout || tab.contents;
            walkNavigation(children, tabParts, slugMap);
        }
    }
}

/**
 * Search upward from a product yml file to find the root docs.yml
 * that contains a "products" key referencing this file.
 */
function findRootDocsYml(productYmlPath) {
    let dir = path.dirname(productYmlPath);

    for (let i = 0; i < 10; i++) {
        const candidate = path.join(dir, 'docs.yml');
        if (fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(productYmlPath)) {
            try {
                const content = fs.readFileSync(candidate, 'utf8');
                const parsed = yaml.parse(content);
                if (parsed && parsed.products) {
                    return { filePath: candidate, content: parsed };
                }
            } catch {
                // Skip files that fail to parse
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * Given a root docs.yml and a product yml file path, find the product's slug.
 */
function getProductSlug(rootInfo, productYmlPath) {
    if (!rootInfo || !rootInfo.content.products) return null;

    const rootDir = path.dirname(rootInfo.filePath);
    const resolvedProductPath = path.resolve(productYmlPath);

    for (const product of rootInfo.content.products) {
        if (!product.path) continue;
        const resolvedPath = path.resolve(rootDir, product.path);
        if (resolvedPath === resolvedProductPath) {
            return product.slug || null;
        }
    }
    return null;
}

/**
 * Build VS Code decoration objects for each path line that has a computed slug.
 */
function buildSlugDecorations(document, slugMap) {
    if (slugMap.size === 0) return [];

    const decorations = [];
    const text = document.getText();
    const lines = text.split('\n');

    const pathPattern = /^(\s*path:\s*)(.+)$/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = pathPattern.exec(line);
        if (!match) continue;

        // Strip surrounding quotes from the path value
        const pathValue = match[2].trim().replace(/^["']|["']$/g, '');
        const slug = slugMap.get(pathValue);
        if (!slug) continue;

        const range = new vscode.Range(
            new vscode.Position(i, line.length),
            new vscode.Position(i, line.length)
        );

        decorations.push({
            range,
            renderOptions: {
                after: {
                    contentText: `  slug: /${slug}`,
                    color: new vscode.ThemeColor('editorGhostText.foreground'),
                    fontStyle: 'italic',
                }
            }
        });
    }

    return decorations;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};

