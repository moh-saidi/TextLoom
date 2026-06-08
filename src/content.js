console.log("TextLoom content script loaded.");

let lastSelection = '';
let hasShownError = false; // Track if we've shown error to avoid spam

document.addEventListener('mouseup', (event) => {
    const selectedText = window.getSelection().toString().trim();

    if (selectedText && selectedText !== lastSelection) {
        console.log("Text selected:", selectedText);
        lastSelection = selectedText;
        
        // Check if chrome runtime exists and is valid
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            // Extension is disabled or not available - don't show any error
            return;
        }
        
        // Try to communicate with extension
        try {
            chrome.runtime.sendMessage({ type: 'getActiveFolderId' }, (response) => {
                if (chrome.runtime.lastError) {
                    // Only show error if context is invalidated (not disabled)
                    if (!hasShownError && chrome.runtime.lastError.message.includes('context')) {
                        hasShownError = true;
                        console.warn("Extension context is invalid. Please refresh this page.");
                        
                        // Show a more prominent notification
                        const notification = document.createElement('div');
                        notification.style.cssText = `
                            position: fixed;
                            top: 20px;
                            right: 20px;
                            background: #f44336;
                            color: white;
                            padding: 12px 16px;
                            border-radius: 4px;
                            z-index: 10000;
                            font-family: Arial, sans-serif;
                            font-size: 14px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        `;
                        notification.textContent = '⚠️ TextLoom: Please refresh this page to enable text selection';
                        document.body.appendChild(notification);
                        
                        // Auto-remove notification after 5 seconds
                        setTimeout(() => {
                            if (notification.parentNode) {
                                notification.parentNode.removeChild(notification);
                            }
                        }, 5000);
                    }
                    return;
                }
                
                // Use the active folder ID or fall back to default
                const activeFolderId = response && response.folderId ? response.folderId : 'default';
                console.log(`Content script: Got active folder ID: ${activeFolderId} from storage`);
                
                // Save directly to the active folder
                saveSelection(selectedText, activeFolderId, event.clientX, event.clientY);
            });
        } catch (error) {
            // Extension is not available - silently return
            return;
        }
    }
});

function showQuickFolderSelector(x, y, selectedText, folders, lastUsedFolderId) {
    // Create the selector container
    const selector = document.createElement('div');
    selector.style.position = 'fixed';
    selector.style.left = `${x}px`;
    selector.style.top = `${y - 40}px`;
    selector.style.backgroundColor = 'white';
    selector.style.border = '1px solid #ddd';
    selector.style.borderRadius = '5px';
    selector.style.padding = '5px';
    selector.style.zIndex = '999999';
    selector.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    selector.style.fontSize = '12px';
    
    // Add message
    const message = document.createElement('div');
    message.textContent = 'Save to folder:';
    message.style.marginBottom = '5px';
    message.style.fontWeight = 'bold';
    message.style.fontSize = '11px';
    message.style.color = '#555';
    selector.appendChild(message);
    
    // Add folder buttons (show maximum 3-4 folders plus a "more" option)
    const folderContainer = document.createElement('div');
    folderContainer.style.display = 'flex';
    folderContainer.style.flexWrap = 'wrap';
    folderContainer.style.gap = '5px';
    selector.appendChild(folderContainer);
    
    // Always show default folder first
    const defaultFolder = folders.find(f => f.id === 'default') || { id: 'default', name: 'Uncategorized', color: '#808080' };
    
    // Sort the rest by last used, then name
    console.log("All folders:", folders);
    console.log("Last used folder ID:", lastUsedFolderId);
    
    const otherFolders = folders
        .filter(f => f.id !== 'default')
        .sort((a, b) => {
            // Put last used folder first
            if (a.id === lastUsedFolderId) return -1;
            if (b.id === lastUsedFolderId) return 1;
            return a.name.localeCompare(b.name);
        });
    
    // Show the default and up to 2 other folders
    const foldersToShow = [defaultFolder, ...otherFolders.slice(0, 2)];
    
    foldersToShow.forEach(folder => {
        const folderBtn = document.createElement('button');
        folderBtn.textContent = folder.name;
        folderBtn.style.background = folder.id === lastUsedFolderId ? `${folder.color}20` : 'white';
        folderBtn.style.border = `1px solid ${folder.color}`;
        folderBtn.style.borderRadius = '3px';
        folderBtn.style.padding = '3px 8px';
        folderBtn.style.fontSize = '11px';
        folderBtn.style.cursor = 'pointer';
        folderBtn.style.color = folder.color;
        folderBtn.style.fontWeight = folder.id === lastUsedFolderId ? 'bold' : 'normal';
        
        folderBtn.addEventListener('click', () => {
            saveSelection(selectedText, folder.id, x, y);
            document.body.removeChild(selector);
        });
        
        folderContainer.appendChild(folderBtn);
    });
    
    // Add "More" button if there are more folders
    if (folders.length > 3) {
        const moreBtn = document.createElement('button');
        moreBtn.textContent = '...';
        moreBtn.style.background = '#f0f0f0';
        moreBtn.style.border = '1px solid #ccc';
        moreBtn.style.borderRadius = '3px';
        moreBtn.style.padding = '3px 8px';
        moreBtn.style.fontSize = '11px';
        moreBtn.style.cursor = 'pointer';
        
        moreBtn.addEventListener('click', () => {
            document.body.removeChild(selector);
            showFullFolderSelector(x, y, selectedText, folders, lastUsedFolderId);
        });
        
        folderContainer.appendChild(moreBtn);
    }
    
    // Add close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '2px';
    closeBtn.style.right = '5px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.color = '#777';
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(selector);
    });
    selector.appendChild(closeBtn);
    
    // Auto-close after 5 seconds of inactivity
    let timeout = setTimeout(() => {
        if (document.body.contains(selector)) {
            document.body.removeChild(selector);
            // Save to default folder if no choice made
            saveSelection(selectedText, lastUsedFolderId, x, y);
        }
    }, 5000);
    
    // Reset timeout on hover
    selector.addEventListener('mouseenter', () => {
        clearTimeout(timeout);
    });
    
    selector.addEventListener('mouseleave', () => {
        timeout = setTimeout(() => {
            if (document.body.contains(selector)) {
                document.body.removeChild(selector);
                // Save to default folder if no choice made
                saveSelection(selectedText, lastUsedFolderId, x, y);
            }
        }, 5000);
    });
    
    document.body.appendChild(selector);
    
    // Adjust position if near edge of screen
    if (x + selector.offsetWidth > window.innerWidth) {
        selector.style.left = `${window.innerWidth - selector.offsetWidth - 10}px`;
    }
    
    if (y - selector.offsetHeight < 0) {
        selector.style.top = `${y + 20}px`;
    }
}

function showFullFolderSelector(x, y, selectedText, folders, lastUsedFolderId) {
    // Create a more comprehensive folder selector
    const selector = document.createElement('div');
    selector.style.position = 'fixed';
    selector.style.left = `${x}px`;
    selector.style.top = `${y - 40}px`;
    selector.style.backgroundColor = 'white';
    selector.style.border = '1px solid #ddd';
    selector.style.borderRadius = '5px';
    selector.style.padding = '10px';
    selector.style.zIndex = '999999';
    selector.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    selector.style.fontSize = '12px';
    selector.style.maxHeight = '300px';
    selector.style.overflowY = 'auto';
    selector.style.width = '200px';
    
    // Add title
    const title = document.createElement('h3');
    title.textContent = 'Save to Folder';
    title.style.margin = '0 0 10px 0';
    title.style.fontSize = '14px';
    title.style.borderBottom = '1px solid #eee';
    title.style.paddingBottom = '5px';
    selector.appendChild(title);
    
    // Sort folders - default first, then alphabetically
    const sortedFolders = [...folders].sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return a.name.localeCompare(b.name);
    });
    
    // Add each folder as an option
    sortedFolders.forEach(folder => {
        const folderOption = document.createElement('div');
        folderOption.style.padding = '8px';
        folderOption.style.cursor = 'pointer';
        folderOption.style.borderRadius = '3px';
        folderOption.style.marginBottom = '3px';
        folderOption.style.display = 'flex';
        folderOption.style.alignItems = 'center';
        
        // Highlight last used folder
        if (folder.id === lastUsedFolderId) {
            folderOption.style.backgroundColor = `${folder.color}20`;
            folderOption.style.fontWeight = 'bold';
        }
        
        folderOption.innerHTML = `
            <span style="display:inline-block;width:12px;height:12px;background-color:${folder.color};border-radius:2px;margin-right:8px;"></span>
            ${folder.name}
        `;
        
        folderOption.addEventListener('mouseover', () => {
            if (folder.id !== lastUsedFolderId) {
                folderOption.style.backgroundColor = '#f5f5f5';
            }
        });
        
        folderOption.addEventListener('mouseout', () => {
            if (folder.id !== lastUsedFolderId) {
                folderOption.style.backgroundColor = 'transparent';
            }
        });
        
        folderOption.addEventListener('click', () => {
            console.log(`Selected folder: ${folder.name} (${folder.id})`);
            saveSelection(selectedText, folder.id, x, y);
            document.body.removeChild(selector);
        });
        
        selector.appendChild(folderOption);
    });
    
    // Add close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '10px';
    closeBtn.style.right = '10px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.fontSize = '16px';
    closeBtn.style.color = '#777';
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(selector);
    });
    selector.appendChild(closeBtn);
    
    document.body.appendChild(selector);
    
    // Adjust position if near edge of screen
    if (x + selector.offsetWidth > window.innerWidth) {
        selector.style.left = `${window.innerWidth - selector.offsetWidth - 10}px`;
    }
    
    if (y + selector.offsetHeight > window.innerHeight) {
        selector.style.top = `${window.innerHeight - selector.offsetHeight - 10}px`;
    }
}

function saveSelection(text, folderId, x, y) {
    console.log(`Saving selection to folder ID: ${folderId}`);
    
    // Check if chrome runtime exists and is valid
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        // Extension is disabled or not available - don't show any error
        return;
    }
    
    chrome.runtime.sendMessage({ 
        type: 'addSelection', 
        text: text,
        folderId: folderId
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message failed:", chrome.runtime.lastError);
            
            // Check if it's an extension context invalidation error
            if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                console.warn('Extension context invalidated. Please reload the extension and refresh this page.');
                showConfirmation(x, y, '⚠️ Reload Extension', true);
                return;
            }
            return;
        }
        
        console.log("Received response from background:", response);
        if (response && response.success) {
            console.log(`Selection saved successfully to folder: ${folderId}`);
            showConfirmation(x, y, '✓ Saved');
        } else if (response && response.limitReached) {
            console.log("Limit reached, showing warning.");
            showConfirmation(x, y, '⚠️ Limit Reached', true);
        } else {
            console.log("Selection not saved by background script (is capturing off?).");
        }
    });
}

function showConfirmation(x, y, message, isWarning = false) {
    const confirmation = document.createElement('div');
    confirmation.textContent = message;
    confirmation.style.position = 'fixed';
    confirmation.style.left = `${x}px`;
    confirmation.style.top = `${y - 30}px`;
    confirmation.style.backgroundColor = isWarning ? 'rgba(255, 193, 7, 0.9)' : 'rgba(40, 167, 69, 0.9)';
    confirmation.style.color = isWarning ? '#212529' : 'white';
    confirmation.style.padding = '5px 10px';
    confirmation.style.borderRadius = '5px';
    confirmation.style.zIndex = '999999';
    confirmation.style.fontSize = '12px';
    confirmation.style.pointerEvents = 'none';
    confirmation.style.transition = 'opacity 0.5s ease-out';
    confirmation.style.fontWeight = 'bold';
    confirmation.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    
    document.body.appendChild(confirmation);

    setTimeout(() => {
        confirmation.style.opacity = '0';
    }, isWarning ? 2000 : 500);

    setTimeout(() => {
        if (document.body.contains(confirmation)) {
            document.body.removeChild(confirmation);
        }
    }, isWarning ? 2500 : 1000);
}