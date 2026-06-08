importScripts('storage.js');

let isCapturing = false;
let selections = [];
let isInitialized = false;
let storageManager; // Add this line

// Initialize storage manager
async function initializeStorageManager() {
    if (!storageManager) {
        storageManager = new StorageManager();
    }
}

// --- Persistent Storage with Browser Restart Support ---
async function loadSelectionsFromStorage() {
    try {
        await initializeStorageManager(); // Add this line
        const result = await chrome.storage.local.get(['selections', 'isCapturing']);
        selections = result.selections || [];
        isCapturing = result.isCapturing || false;
        isInitialized = true;
        
        console.log('Loaded from storage:', { 
            selectionsCount: selections.length, 
            isCapturing 
        });
        
        updateIcon();
        updateContextMenu();
    } catch (error) {
        console.error('Failed to load data from storage:', error);
        selections = [];
        isCapturing = false;
        isInitialized = true;
    }
}

async function saveSelectionsToStorage() {
    if (!isInitialized) return; // Don't save before loading
    
    try {
        await chrome.storage.local.set({ 
            selections, 
            isCapturing,
            lastSaved: Date.now()
        });
        console.log('Saved to storage:', { 
            selectionsCount: selections.length, 
            isCapturing 
        });
    } catch (error) {
        console.error('Failed to save data to storage:', error);
    }
}

// --- State Management ---
async function toggleCapturing() {
    await ensureInitialized();
    isCapturing = !isCapturing;
    updateIcon();
    updateContextMenu();
    await saveSelectionsToStorage();
}

async function ensureInitialized() {
    if (!isInitialized) {
        await loadSelectionsFromStorage();
    }
}

function updateIcon() {
    if (!isInitialized) return;
    
    // Use badge text instead of changing icons
    chrome.action.setBadgeText({ 
        text: isCapturing ? "ON" : "" 
    });
    chrome.action.setBadgeBackgroundColor({ 
        color: isCapturing ? "#e53935" : "#000000" 
    });
    
    // Optional: Also update the title
    chrome.action.setTitle({
        title: isCapturing ? "TextLoom - Capturing ON" : "TextLoom - Capturing OFF"
    });
}

// --- Context Menu ---
async function setupContextMenu() {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
        id: 'toggle-capture',
        title: 'Start Capturing Selections',
        contexts: ['page']
    });
    
    chrome.contextMenus.create({
        id: 'capture-to-folder',
        title: 'Capture to Folder',
        contexts: ['selection']
    });
    
    await rebuildFolderContextMenus();
}

async function rebuildFolderContextMenus() {
    // Remove old folder sub-items
    await chrome.contextMenus.removeAll();
    
    // Recreate root items
    chrome.contextMenus.create({
        id: 'toggle-capture',
        title: 'Start Capturing Selections',
        contexts: ['page']
    });
    
    chrome.contextMenus.create({
        id: 'capture-to-folder',
        title: 'Capture to Folder',
        contexts: ['selection']
    });
    
    // Add folder sub-items
    if (storageManager) {
        const folders = await storageManager.getFolders();
        for (const folder of folders) {
            chrome.contextMenus.create({
                id: `folder-${folder.id}`,
                parentId: 'capture-to-folder',
                title: folder.name,
                contexts: ['selection']
            });
        }
    }
    
    updateToggleLabel();
}

function updateContextMenu() {
    updateToggleLabel();
}

function updateToggleLabel() {
    if (!isInitialized) return;
    chrome.contextMenus.update('toggle-capture', {
        title: isCapturing ? 'Stop Capturing Selections' : 'Start Capturing Selections'
    });
}

// --- Event Listeners for All Startup Scenarios ---
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('Extension installed/updated:', details.reason);
    await setupContextMenu();
    await loadSelectionsFromStorage();
    
    // Initialize default folders if they don't exist
    const folders = await storageManager.getFolders();
    if (folders.length === 0) {
        await chrome.storage.local.set({
            folders: storageManager.defaultFolders
        });
    }

    // Migrate selections to add tags field
    await storageManager.migrateSelections();
});

// Open sidebar when action icon is clicked (no popup)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('sidePanel.setPanelBehavior failed:', err);
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Browser started');
    await loadSelectionsFromStorage();
});

// This ensures we load data even when service worker is reactivated
chrome.runtime.onConnect.addListener(async () => {
    await ensureInitialized();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'toggle-capture') {
        await toggleCapturing();
    } else if (info.menuItemId === 'capture-to-folder') {
        // Capture to the most recently used folder
        if (info.selectionText) {
            await ensureInitialized();
            const lastUsedFolderId = await storageManager.getLastUsedFolderId();
            await captureToFolder(info.selectionText, tab ? tab.url : '', lastUsedFolderId);
        }
    } else if (info.menuItemId.startsWith('folder-')) {
        // Extract the folder ID from the menu item ID
        const folderId = info.menuItemId.replace('folder-', '');
        await captureToFolder(info.selectionText, tab.url, folderId);
    }
});

async function captureToFolder(text, url, folderId) {
    await ensureInitialized();
    
    selections.push({
        id: 'sel_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        text: text,
        url: url,
        timestamp: Date.now(),
        starred: false,
        folderId: folderId
    });
    
    await saveSelectionsToStorage();
    
    // Notify the content script
    try {
        await chrome.tabs.sendMessage(tab.id, { 
            type: 'captureConfirm', 
            success: true 
        });
    } catch (error) {
        console.error("Failed to send confirmation:", error);
    }
}

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-capture') {
        await toggleCapturing();
    }
});

// --- Message Handling with Initialization Check ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            await ensureInitialized();
            
            if (request.type === 'checkCapturingAndFolders') {
                if (isCapturing) {
                    const folders = await storageManager.getFolders();
                    const lastUsedFolderId = await storageManager.getLastUsedFolderId();
                    
                    sendResponse({ 
                        isCapturing: true,
                        folders: folders,
                        lastUsedFolderId: lastUsedFolderId
                    });
                } else {
                    sendResponse({ isCapturing: false });
                }
                return;
            }
            
            if (request.type === 'addSelection') {
            if (isCapturing) {
                // Set the last used folder and make sure it's valid
                let folderId = request.folderId || 'default';
                console.log(`Adding selection with folder ID: ${folderId}`);
                
                // Save the folder ID as last used if it's not default
                if (folderId !== 'default') {
                    await storageManager.setLastUsedFolderId(folderId);
                    console.log(`Set last used folder ID to: ${folderId}`);
                }
                
                // Generate a unique ID for the selection
                const selectionId = 'sel_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                
                selections.push({
                    id: selectionId,
                    text: request.text,
                    url: sender.tab.url,
                    timestamp: Date.now(),
                    starred: false,
                    folderId: folderId
                });
                await saveSelectionsToStorage();
                sendResponse({ success: true, count: selections.length });
            } else {
                sendResponse({ success: false });
            }
            return;
        }

        if (request.type === 'getSelections') {
            // If forceRefresh is requested, reload from storage
            if (request.forceRefresh) {
                const result = await chrome.storage.local.get(['selections']);
                selections = result.selections || [];
                console.log('Force refreshed selections from storage:', selections.length);
            }
            sendResponse({ selections, isCapturing });
            return;
        }

        if (request.type === 'setSelections') {
            selections = request.selections;
            await saveSelectionsToStorage();
            sendResponse({ success: true });
            return;
        }

        if (request.type === 'clearSelections') {
            selections = [];
            await saveSelectionsToStorage();
            sendResponse({ success: true });
            return;
        }

        if (request.type === 'openOptions') {
            chrome.runtime.openOptionsPage();
            sendResponse({});
            return;
        }

        // Folder management handlers
        if (request.type === 'getFolders') {
            const folders = await storageManager.getFolders();
            const lastUsedFolderId = await storageManager.getLastUsedFolderId();
            sendResponse({ 
                folders, 
                lastUsedFolderId 
            });
            return;
        }

        if (request.type === 'saveFolder') {
            const result = await storageManager.saveFolder(request.folder);
            await rebuildFolderContextMenus();
            sendResponse({ success: true, folder: result });
            return;
        }

        if (request.type === 'deleteFolder') {
            const result = await storageManager.deleteFolder(request.folderId);
            await rebuildFolderContextMenus();
            selections = (await chrome.storage.local.get(['selections'])).selections || [];
            sendResponse(result);
            return;
        }

        if (request.type === 'moveSelectionToFolder') {
            const result = await storageManager.moveSelectionToFolder(request.selectionId, request.folderId);
            selections = (await chrome.storage.local.get(['selections'])).selections || [];
            sendResponse({ success: result });
            return;
        }

        if (request.type === 'bulkMoveToFolder') {
            console.log('Bulk move request received:', request);
            
            // Validate the parameters
            if (!request.selectionIds || !Array.isArray(request.selectionIds) || !request.folderId) {
                console.error('Invalid parameters for bulkMoveToFolder:', request);
                sendResponse({ success: false, error: 'Invalid parameters' });
                return;
            }
            
            let success = true;
            for (const selId of request.selectionIds) {
                console.log(`Moving selection ${selId} to folder ${request.folderId}`);
                const result = await storageManager.moveSelectionToFolder(selId, request.folderId);
                if (!result) {
                    console.error(`Failed to move selection ${selId} to folder ${request.folderId}`);
                    success = false;
                }
            }
            
            // Refresh the cached selections array after moves
            if (success) {
                const result = await chrome.storage.local.get(['selections']);
                selections = result.selections || [];
                console.log('Refreshed cached selections after move:', selections.length);
            }
            
            sendResponse({ success });
            return;
        }
        
        if (request.type === 'setActiveFolderId') {
            await storageManager.setActiveFolderId(request.folderId);
            sendResponse({ success: true });
            return;
        }
        
        if (request.type === 'getActiveFolderId') {
            const activeFolderId = await storageManager.getActiveFolderId();
            sendResponse({ folderId: activeFolderId });
            return;
        }

        // Tag handlers
        if (request.type === 'addTag') {
            const result = await storageManager.addTag(request.selectionId, request.tag);
            selections = (await chrome.storage.local.get(['selections'])).selections || [];
            sendResponse({ success: result });
            return;
        }

        if (request.type === 'removeTag') {
            const result = await storageManager.removeTag(request.selectionId, request.tag);
            selections = (await chrome.storage.local.get(['selections'])).selections || [];
            sendResponse({ success: result });
            return;
        }

        if (request.type === 'bulkAddTag') {
            const result = await storageManager.bulkAddTag(request.selectionIds, request.tag);
            selections = (await chrome.storage.local.get(['selections'])).selections || [];
            sendResponse({ success: result });
            return;
        }

        if (request.type === 'getAllTags') {
            const tags = await storageManager.getAllTags();
            sendResponse({ tags });
            return;
        }

        // If no handler matched, send empty response
        sendResponse({});
    } catch (err) {
        console.error('Message handler error:', err);
        try { sendResponse({ error: err.message }); } catch {}
    }
    })();
    
    return true; // Keep message channel open for async response
});

// --- Auto-save periodically (backup mechanism) ---
setInterval(async () => {
    if (isInitialized && selections.length > 0) {
        await saveSelectionsToStorage();
    }
}, 30000); // Save every 30 seconds as backup