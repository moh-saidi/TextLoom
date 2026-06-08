class StorageManager {
    constructor() {
        this.defaultFolders = [
            { id: 'default', name: 'Uncategorized', color: '#808080', isDefault: true }
        ];
    }

    async get(key) {
        const result = await chrome.storage.local.get(key);
        return result[key];
    }

    async set(data) {
        return chrome.storage.local.set(data);
    }

    async getFolders() {
        const result = await chrome.storage.local.get(['folders']);
        return result.folders || this.defaultFolders;
    }

    async saveFolder(folder) {
        const folders = await this.getFolders();
        
        if (folder.id) {
            // Update existing folder
            const index = folders.findIndex(f => f.id === folder.id);
            if (index !== -1) {
                folders[index] = folder;
            }
        } else {
            // Create new folder
            folder.id = 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            folders.push(folder);
        }
        
        await chrome.storage.local.set({ folders });
        return folder;
    }

    async deleteFolder(folderId) {
        let folders = await this.getFolders();
        
        // Don't allow deleting the default folder
        if (folders.find(f => f.id === folderId && f.isDefault)) {
            return { success: false, message: "Cannot delete the default folder" };
        }
        
        // Get all selections to update their folder assignment
        const result = await chrome.storage.local.get(['selections']);
        let selections = result.selections || [];
        
        // Move selections from the deleted folder to default folder
        selections = selections.map(s => {
            if (s.folderId === folderId) {
                return { ...s, folderId: 'default' };
            }
            return s;
        });
        
        // Remove the folder
        folders = folders.filter(f => f.id !== folderId);
        
        // Save changes
        await chrome.storage.local.set({ 
            folders,
            selections
        });
        
        return { success: true };
    }

    async moveSelectionToFolder(selectionId, folderId) {
        const result = await chrome.storage.local.get(['selections']);
        const selections = result.selections || [];
        
        console.log(`Moving selection ${selectionId} to folder ${folderId}`);
        console.log('Available selections IDs:', selections.map(s => s.id));
        
        const index = selections.findIndex(s => s.id === selectionId);
        if (index !== -1) {
            console.log(`Found selection at index ${index}, updating folderId`);
            selections[index].folderId = folderId;
            await chrome.storage.local.set({ selections });
            return true;
        } else {
            console.error(`Selection with ID ${selectionId} not found!`);
            return false;
        }
    }
    
    async getLastUsedFolderId() {
        const result = await chrome.storage.local.get(['lastUsedFolderId']);
        return result.lastUsedFolderId || 'default';
    }
    
    async setLastUsedFolderId(folderId) {
        await chrome.storage.local.set({ lastUsedFolderId: folderId });
    }
    
    async getActiveFolderId() {
        const result = await chrome.storage.local.get(['activeFolderId']);
        return result.activeFolderId || 'default';
    }
    
    async setActiveFolderId(folderId) {
        await chrome.storage.local.set({ activeFolderId: folderId });
    }

    async addTag(selectionId, tag) {
        const result = await chrome.storage.local.get(['selections']);
        const selections = result.selections || [];
        const index = selections.findIndex(s => s.id === selectionId);
        if (index === -1) return false;
        if (!selections[index].tags) selections[index].tags = [];
        if (!selections[index].tags.includes(tag)) {
            selections[index].tags.push(tag);
            await chrome.storage.local.set({ selections });
        }
        return true;
    }

    async removeTag(selectionId, tag) {
        const result = await chrome.storage.local.get(['selections']);
        const selections = result.selections || [];
        const index = selections.findIndex(s => s.id === selectionId);
        if (index === -1) return false;
        if (!selections[index].tags) return true;
        selections[index].tags = selections[index].tags.filter(t => t !== tag);
        await chrome.storage.local.set({ selections });
        return true;
    }

    async bulkAddTag(selectionIds, tag) {
        const result = await chrome.storage.local.get(['selections']);
        const selections = result.selections || [];
        for (const id of selectionIds) {
            const s = selections.find(sel => sel.id === id);
            if (!s) continue;
            if (!s.tags) s.tags = [];
            if (!s.tags.includes(tag)) s.tags.push(tag);
        }
        await chrome.storage.local.set({ selections });
        return true;
    }

    async getAllTags() {
        const result = await chrome.storage.local.get(['selections']);
        const selections = result.selections || [];
        const tagSet = new Set();
        for (const s of selections) {
            if (s.tags) s.tags.forEach(t => tagSet.add(t));
        }
        return [...tagSet].sort();
    }

    async migrateSelections() {
        const result = await chrome.storage.local.get(['selections']);
        const selections = result.selections || [];
        let needsUpdate = false;
        selections.forEach(s => {
            if (!s.tags) { s.tags = []; needsUpdate = true; }
            if (!s.id) { s.id = 'sel_' + Date.now() + '_' + Math.random(); needsUpdate = true; }
            if (!s.folderId) { s.folderId = 'default'; needsUpdate = true; }
        });
        if (needsUpdate) await chrome.storage.local.set({ selections });
        return selections;
    }
}

// Don't assign to window - just export the class
// Each context will create its own instance