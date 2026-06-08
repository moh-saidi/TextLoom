const _origSendMsg = chrome.runtime.sendMessage.bind(chrome.runtime);
chrome.runtime.sendMessage = function(msg, cb) {
    const result = _origSendMsg(msg, cb);
    if (result && typeof result.catch === 'function') result.catch(() => {});
    return result;
};

document.addEventListener('DOMContentLoaded', () => {
    const selectionList = document.getElementById('selectionList');
    const exportBtn = document.getElementById('exportBtn');
    const clearBtn = document.getElementById('clearBtn');
    const optionsLink = document.getElementById('optionsLink');
    const captureStatus = document.getElementById('captureStatus');
    const darkModeBtn = document.getElementById('darkModeBtn');
    const folderList = document.getElementById('folderList');
    const createFolderBtn = document.getElementById('createFolderBtn');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const folderSearch = document.getElementById('folderSearch');
    const toggleFoldersBtn = document.getElementById('toggleFoldersBtn');
    const folderListContainer = document.getElementById('folderListContainer');
    const tagList = document.getElementById('tagList');
    const clearTagFilterBtn = document.getElementById('clearTagFilter');
    const tagSelectedBtn = document.getElementById('tagSelectedBtn');
    const helpBtn = document.getElementById('helpBtn');
    const helpModal = document.getElementById('helpModal');
    const closeHelpBtn = document.getElementById('closeHelpBtn');
    const statsToggle = document.getElementById('statsToggle');
    const statsBar = document.getElementById('statsBar');
    const onboardingModal = document.getElementById('onboardingModal');
    const dismissOnboarding = document.getElementById('dismissOnboarding');
    const tagInputOverlay = document.getElementById('tagInputOverlay');
    const tagInput = document.getElementById('tagInput');
    const tagInputCancel = document.getElementById('tagInputCancel');
    const tagInputSave = document.getElementById('tagInputSave');
    const selectionCount = document.getElementById('selectionCount');

    let selections = [];
    let folders = [];
    let currentFolderId = 'all';
    let selectedIndexes = [];
    let activeTagFilter = null;
    let sortBy = 'starred';
    let focusIndex = -1;
    let statusCheckInterval = null;
    let pendingTagSelectionIds = [];

    const { escapeHtml, getDomainFromUrl, formatTime, downloadFile, getMimeType } = window.utils;

    function getFavicon(url) {
        try { return new URL(url).origin + '/favicon.ico'; } catch { return ''; }
    }

    function storageKey(key) { return 'archive-' + key; }

    let keepalivePort = null;

    function connectKeepalivePort() {
        try {
            keepalivePort = chrome.runtime.connect({ name: 'sidebar-keepalive' });
            keepalivePort.onDisconnect.addListener(() => {
                keepalivePort = null;
                if (chrome.runtime.lastError) {
                    setTimeout(connectKeepalivePort, 1000);
                }
            });
        } catch {
            setTimeout(connectKeepalivePort, 2000);
        }
    }

    function init() {
        connectKeepalivePort();

        const onboardingDone = localStorage.getItem(storageKey('onboarding-done'));
        if (!onboardingDone) setTimeout(() => {
            onboardingModal.classList.remove('hidden');
        }, 400);

        sortBy = localStorage.getItem(storageKey('sort')) || 'starred';
        document.getElementById('sortSelect').value = sortBy;

        loadFolders(() => {
            loadSelections();
        });
        setupEventListeners();
        setupDarkMode();
        setupFolderCollapse();
        setupStorageListener();
        startStatusPolling();
    }

    function setupFolderCollapse() {
        const expanded = localStorage.getItem(storageKey('folders-expanded')) === 'true';
        if (expanded) {
            folderListContainer.classList.add('expanded');
            toggleFoldersBtn.innerHTML = '&#9650;';
        }
        toggleFoldersBtn.addEventListener('click', () => {
            folderListContainer.classList.toggle('expanded');
            toggleFoldersBtn.innerHTML = folderListContainer.classList.contains('expanded') ? '&#9650;' : '&#9660;';
            localStorage.setItem(storageKey('folders-expanded'), folderListContainer.classList.contains('expanded'));
        });
        folderSearch.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('#folderList li:not([data-folder-id="all"]):not([data-folder-id="default"])').forEach(li => {
                const name = li.querySelector('.folder-name')?.textContent?.toLowerCase() || '';
                li.style.display = name.includes(term) ? '' : 'none';
            });
        });
    }

    async function loadFolders(callback) {
        chrome.storage.local.get(['activeFolderId', 'folders'], (result) => {
            if (result.activeFolderId) currentFolderId = result.activeFolderId;
            folders = result.folders || [{ id: 'default', name: 'Uncategorized', color: '#808080', isDefault: true }];
            if (callback) callback();
        });
    }

    function setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            let changed = false;
            if (changes.selections) {
                selections = changes.selections.newValue || [];
                changed = true;
            }
            if (changes.folders) {
                folders = changes.folders.newValue || [];
                changed = true;
            }
            if (changed) renderAll();
            if (changes.selections) updateTagDisplay();
        });
    }

    function startStatusPolling() {
        statusCheckInterval = setInterval(() => {
            chrome.storage.local.get(['selections', 'isCapturing'], (result) => {
                if (chrome.runtime.lastError) return;
                if (result.isCapturing !== undefined) updateCaptureStatus(result.isCapturing);
                if (result.selections && JSON.stringify(result.selections) !== JSON.stringify(selections)) {
                    selections = result.selections;
                    renderAll();
                }
            });
            chrome.storage.local.get(['folders'], (result) => {
                if (result.folders && JSON.stringify(result.folders) !== JSON.stringify(folders)) {
                    folders = result.folders;
                    renderFolders();
                }
            });
        }, 10000);
    }

    function renderAll() {
        renderFolders();
        renderSelections();
        updateStats();
    }

    function getPinnedFolders() {
        try { return JSON.parse(localStorage.getItem(storageKey('pinned-folders'))) || []; } catch { return []; }
    }

    function setPinnedFolders(pinned) {
        localStorage.setItem(storageKey('pinned-folders'), JSON.stringify(pinned));
    }

    function togglePinFolder(folderId) {
        const pinned = getPinnedFolders();
        const idx = pinned.indexOf(folderId);
        if (idx >= 0) pinned.splice(idx, 1); else pinned.push(folderId);
        setPinnedFolders(pinned);
        renderFolders();
    }

    function renderFolders() {
        folderList.innerHTML = '';
        const allCount = selections.length;
        const defaultCount = selections.filter(s => !s.folderId || s.folderId === 'default').length;
        const pinnedIds = getPinnedFolders();

        const allLi = document.createElement('li');
        allLi.dataset.folderId = 'all';
        allLi.classList.toggle('active', currentFolderId === 'all');
        allLi.innerHTML = `<div class="folder-name"><span class="folder-icon">&#128193;</span>All Items</div>${allCount > 0 ? `<span class="folder-count">${allCount}</span>` : ''}`;
        folderList.appendChild(allLi);

        const defFolder = folders.find(f => f.id === 'default') || { id: 'default', name: 'Uncategorized', color: '#808080' };
        const defLi = document.createElement('li');
        defLi.dataset.folderId = 'default';
        defLi.classList.toggle('active', currentFolderId === 'default');
        defLi.innerHTML = `<div class="folder-name"><span class="folder-color" style="background:${defFolder.color}"></span>${defFolder.name}</div>${defaultCount > 0 ? `<span class="folder-count">${defaultCount}</span>` : ''}`;
        folderList.appendChild(defLi);

        const custom = folders.filter(f => !f.isDefault);
        custom.sort((a, b) => {
            const aPinned = pinnedIds.includes(a.id);
            const bPinned = pinnedIds.includes(b.id);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return a.name.localeCompare(b.name);
        });

        custom.forEach(f => {
            const li = document.createElement('li');
            li.dataset.folderId = f.id;
            li.classList.toggle('active', currentFolderId === f.id);
            const count = selections.filter(s => s.folderId === f.id).length;
            const isPinned = pinnedIds.includes(f.id);
            li.innerHTML = `
                <div class="folder-name"><span class="folder-color" style="background:${f.color}"></span>${escapeHtml(f.name)}</div>
                <div class="folder-actions">
                    <button class="pin-folder${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin'}">&#128204;</button>
                    <button class="export-folder-btn" title="Export collection">&#8599;</button>
                    <button class="edit-folder" title="Edit">&#9998;</button>
                    <button class="delete-folder" title="Delete">&times;</button>
                </div>
                ${count > 0 ? `<span class="folder-count">${count}</span>` : ''}
            `;
            folderList.appendChild(li);
        });
    }

    function renderTags(tagArray) {
        tagList.innerHTML = '';
        if (!tagArray || tagArray.length === 0) {
            tagList.innerHTML = '<span style="font-size:10px;color:var(--text-dim);padding:2px 0;">No tags yet</span>';
            return;
        }
        const allPill = document.createElement('button');
        allPill.className = 'tag-pill' + (!activeTagFilter ? ' active' : '');
        allPill.textContent = 'All';
        allPill.addEventListener('click', () => { activeTagFilter = null; clearTagFilterBtn.classList.add('hidden'); renderSelections(); renderTags(tagArray); });
        tagList.appendChild(allPill);

        tagArray.forEach(tag => {
            const count = selections.filter(s => s.tags && s.tags.includes(tag)).length;
            const pill = document.createElement('button');
            pill.className = 'tag-pill' + (activeTagFilter === tag ? ' active' : '');
            pill.innerHTML = `${escapeHtml(tag)} <span class="tag-count">${count}</span>`;
            pill.addEventListener('click', () => {
                if (activeTagFilter === tag) {
                    activeTagFilter = null;
                    clearTagFilterBtn.classList.add('hidden');
                } else {
                    activeTagFilter = tag;
                    clearTagFilterBtn.classList.remove('hidden');
                }
                renderSelections();
                renderTags(tagArray);
            });
            tagList.appendChild(pill);
        });
    }

    function getFilteredSelections() {
        let filtered = [...selections];

        if (currentFolderId !== 'all') {
            if (currentFolderId === 'default') filtered = filtered.filter(s => !s.folderId || s.folderId === 'default');
            else filtered = filtered.filter(s => s.folderId === currentFolderId);
        }

        if (activeTagFilter) {
            filtered = filtered.filter(s => s.tags && s.tags.includes(activeTagFilter));
        }

        const query = searchInput.value.trim().toLowerCase();
        if (query) {
            filtered = filtered.filter(s =>
                (s.text && s.text.toLowerCase().includes(query)) ||
                (s.url && s.url.toLowerCase().includes(query))
            );
        }

        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'newest': return b.timestamp - a.timestamp;
                case 'oldest': return a.timestamp - b.timestamp;
                case 'alpha': return (a.text || '').localeCompare(b.text || '');
                case 'alpha-desc': return (b.text || '').localeCompare(a.text || '');
                case 'domain': return (getDomainFromUrl(a.url) || '').localeCompare(getDomainFromUrl(b.url) || '');
                case 'length': return (b.text || '').length - (a.text || '').length;
                default: return (b.starred - a.starred) || (b.timestamp - a.timestamp);
            }
        });
        return filtered;
    }

    function renderSelections() {
        const filtered = getFilteredSelections();
        selectionList.innerHTML = '';

        if (selections.length === 0) {
            selectionList.innerHTML = `
                <div class="empty-state onboarding">
                    <span class="empty-title">Welcome to TextLoom</span>
                    <span class="empty-step">Press <kbd>Ctrl+Shift+Q</kbd> to arm capture</span>
                    <span class="empty-step">Select text on any page &mdash; it saves automatically</span>
                    <span class="empty-step">Open this sidebar to organize and export</span>
                </div>
            `;
            updateButtons(true);
            selectionCount.textContent = '0 selections';
            return;
        }

        if (filtered.length === 0) {
            selectionList.innerHTML = '<div class="empty-state">No matches found</div>';
            updateButtons(true);
            selectionCount.textContent = '0 filtered';
            return;
        }

        filtered.forEach((sel, displayIdx) => {
            const origIdx = selections.indexOf(sel);
            const item = document.createElement('div');
            item.className = 'selection-item' + (selectedIndexes.includes(origIdx) ? ' selected' : '') + (origIdx === focusIndex ? ' focused' : '');
            item.dataset.index = origIdx;

            const folder = folders.find(f => f.id === sel.folderId) || { name: 'Uncategorized', color: '#808080' };
            const faviconUrl = getFavicon(sel.url);
            const domain = getDomainFromUrl(sel.url);

            let metaHtml = `<span>${escapeHtml(domain)}</span> | <span>${formatTime(sel.timestamp)}</span>`;
            if (sel.starred) metaHtml += `<span class="star-label">&#9733; Starred</span>`;
            if (currentFolderId === 'all') metaHtml += ` <span class="folder-tag" style="background:${folder.color}20;color:${folder.color};border:1px solid ${folder.color};">${escapeHtml(folder.name)}</span>`;

            if (sel.tags && sel.tags.length > 0) {
                sel.tags.forEach(t => {
                    metaHtml += ` <span class="mini-tag">${escapeHtml(t)} <button class="remove-tag" data-tag="${escapeHtml(t)}" data-idx="${origIdx}" title="Remove tag">&times;</button></span>`;
                });
            }

            item.innerHTML = `
                <div class="top-row">
                    <span class="select-indicator">${selectedIndexes.includes(origIdx) ? '&#10003;' : ''}</span>
                    ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" class="favicon" alt="">` : ''}
                    <div class="selection-text">${escapeHtml(sel.text)}</div>
                    <div class="action-btns">
                        <button class="action-btn move-btn" data-idx="${origIdx}" title="Move to folder">&#128194;</button>
                        <button class="action-btn star-btn ${sel.starred ? 'starred' : ''}" data-idx="${origIdx}" title="Star">&#9733;</button>
                    </div>
                </div>
                <div class="meta-row">${metaHtml}</div>
            `;

            item.addEventListener('click', (e) => handleSelectionClick(e, origIdx));
            item.addEventListener('dblclick', (e) => {
                if (e.target.closest('.action-btn, .remove-tag')) return;
                openSelectionInTab(sel);
            });

            selectionList.appendChild(item);
        });

        setTimeout(() => {
            document.querySelectorAll('.favicon').forEach(img => {
                img.addEventListener('error', () => { img.style.display = 'none'; });
            });
        }, 0);

        updateButtons(false);
        const visibleCount = filtered.length;
        const totalCount = selections.length;
        selectionCount.textContent = visibleCount < totalCount ? `${visibleCount} of ${totalCount}` : `${totalCount} selections`;
    }

    function handleSelectionClick(e, origIdx) {
        const target = e.target;

        if (target.classList.contains('star-btn')) {
            selections[origIdx].starred = !selections[origIdx].starred;
            chrome.runtime.sendMessage({ type: 'setSelections', selections }, () => renderSelections());
            e.stopPropagation();
            return;
        }

        if (target.classList.contains('move-btn')) {
            const ids = selectedIndexes.length > 1 && selectedIndexes.includes(origIdx)
                ? selectedIndexes.map(i => selections[i].id)
                : [selections[origIdx].id];
            showMoveToFolderDialog(ids);
            e.stopPropagation();
            return;
        }

        if (target.classList.contains('remove-tag')) {
            const tag = target.dataset.tag;
            const idx = parseInt(target.dataset.idx, 10);
            chrome.runtime.sendMessage({ type: 'removeTag', selectionId: selections[idx].id, tag }, () => {
                if (selections[idx].tags) selections[idx].tags = selections[idx].tags.filter(t => t !== tag);
                renderSelections();
                updateTagDisplay();
            });
            e.stopPropagation();
            return;
        }

        if (target.classList.contains('select-indicator')) {
            toggleSelection(origIdx);
            e.stopPropagation();
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            toggleSelection(origIdx);
        } else if (e.shiftKey && focusIndex >= 0) {
            const filtered = getFilteredSelections();
            const currentFocusDisplayIdx = filtered.indexOf(selections[origIdx]);
            const prevFocusDisplayIdx = filtered.indexOf(selections[focusIndex]);
            const start = Math.min(currentFocusDisplayIdx, prevFocusDisplayIdx);
            const end = Math.max(currentFocusDisplayIdx, prevFocusDisplayIdx);
            for (let i = start; i <= end; i++) {
                const idx = selections.indexOf(filtered[i]);
                if (!selectedIndexes.includes(idx)) selectedIndexes.push(idx);
            }
        } else {
            if (selectedIndexes.length === 1 && selectedIndexes[0] === origIdx) {
                selectedIndexes = [];
            } else {
                selectedIndexes = [origIdx];
            }
        }
        focusIndex = origIdx;
        renderSelections();
    }

    function toggleSelection(idx) {
        const pos = selectedIndexes.indexOf(idx);
        if (pos >= 0) selectedIndexes.splice(pos, 1);
        else selectedIndexes.push(idx);
        focusIndex = idx;
        renderSelections();
    }

    function openSelectionInTab(sel) {
        if (!sel.url) return;
        let url = sel.url;
        if (sel.text) {
            const fragment = sel.text.trim().substring(0, 300);
            try { url += '#:~:text=' + encodeURIComponent(fragment); } catch {}
        }
        chrome.tabs.create({ url, active: true });
    }

    function updateTagDisplay() {
        const tagSet = new Set();
        selections.forEach(s => { if (s.tags) s.tags.forEach(t => tagSet.add(t)); });
        renderTags([...tagSet].sort());
    }

    function updateButtons(disabled) {
        exportBtn.disabled = disabled;
        clearBtn.disabled = disabled;
        tagSelectedBtn.disabled = disabled;
    }

    function updateStats() {
        const total = selections.length;
        const starred = selections.filter(s => s.starred).length;
        const folderCount = folders.filter(f => !f.isDefault).length;
        const tagSet = new Set();
        const domainSet = new Set();
        selections.forEach(s => {
            if (s.tags) s.tags.forEach(t => tagSet.add(t));
            try { domainSet.add(new URL(s.url).hostname); } catch {}
        });
        document.getElementById('statTotal').textContent = total;
        document.getElementById('statStarred').textContent = starred;
        document.getElementById('statFolders').textContent = folderCount;
        document.getElementById('statTags').textContent = tagSet.size;
        document.getElementById('statDomains').textContent = domainSet.size;
    }

    function updateCaptureStatus(isCapturing) {
        captureStatus.classList.toggle('active', isCapturing);
        captureStatus.title = isCapturing ? 'Capturing ON' : 'Capturing OFF';
    }

    function showFolderDialog(folder) {
        if (document.getElementById('folderDialog')) return;
        const randomColor = folder ? folder.color : '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.id = 'folderDialog';
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${folder ? 'Edit Collection' : 'New Collection'}</h3>
                <div class="form-group">
                    <label for="fd-name">Name</label>
                    <input type="text" id="fd-name" value="${folder ? escapeHtml(folder.name) : ''}" placeholder="Collection name">
                </div>
                <div class="form-group">
                    <label for="fd-color">Color</label>
                    <input type="color" id="fd-color" value="${randomColor}">
                </div>
                <div class="button-group">
                    <button id="fd-cancel" class="btn">Cancel</button>
                    <button id="fd-save" class="btn btn-primary">${folder ? 'Update' : 'Create'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('fd-save').addEventListener('click', () => {
            const name = document.getElementById('fd-name').value.trim();
            const color = document.getElementById('fd-color').value;
            if (!name) return;
            const folderData = { name, color, ...(folder ? { id: folder.id, isDefault: folder.isDefault } : {}) };
            chrome.runtime.sendMessage({ type: 'saveFolder', folder: folderData }, (resp) => {
                if (resp.success) {
                    if (!folder && resp.folder) {
                        chrome.storage.local.get(['folders'], (fr) => {
                            folders = fr.folders || [];
                            currentFolderId = resp.folder.id;
                            chrome.runtime.sendMessage({ type: 'setActiveFolderId', folderId: currentFolderId });
                            renderAll();
                            const fc = document.getElementById('folderListContainer');
                            if (fc && !fc.classList.contains('expanded')) {
                                fc.classList.add('expanded');
                                toggleFoldersBtn.innerHTML = '&#9650;';
                                localStorage.setItem(storageKey('folders-expanded'), 'true');
                            }
                        });
                    } else {
                        loadFolders(() => renderAll());
                    }
                    document.body.removeChild(overlay);
                }
            });
        });

        document.getElementById('fd-cancel').addEventListener('click', () => document.body.removeChild(overlay));
        setTimeout(() => document.getElementById('fd-name')?.focus(), 100);
    }

    function showMoveToFolderDialog(selectionIds) {
        if (!selectionIds || selectionIds.length === 0) return;
        if (!folders || folders.length === 0) {
            alert('No collections available. Create one first.');
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.innerHTML = `
            <div class="modal-content" style="width:260px;">
                <h3>Move to Collection</h3>
                <div style="max-height:200px;overflow-y:auto;margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius-sm);">
                    ${folders.map(f => `
                        <div class="folder-opt" data-fid="${f.id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);transition:background 0.15s;">
                            <span style="width:8px;height:8px;border-radius:2px;background:${f.color};flex-shrink:0;"></span>
                            ${escapeHtml(f.name)}
                        </div>
                    `).join('')}
                </div>
                <div class="button-group">
                    <button id="mv-cancel" class="btn">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.folder-opt').forEach(opt => {
            opt.addEventListener('click', () => {
                const fid = opt.dataset.fid;
                chrome.runtime.sendMessage({ type: 'bulkMoveToFolder', selectionIds, folderId: fid }, (resp) => {
                    if (resp && resp.success) {
                        selectedIndexes = [];
                        setTimeout(() => loadSelections(), 100);
                        document.body.removeChild(overlay);
                    }
                });
            });
            opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--bg-hover)'; });
            opt.addEventListener('mouseleave', () => { opt.style.background = 'transparent'; });
        });

        document.getElementById('mv-cancel').addEventListener('click', () => document.body.removeChild(overlay));
    }

    function exportSelections() {
        const format = document.getElementById('exportFormat').value;
        const filtered = getFilteredSelections();
        const toExport = selectedIndexes.length > 0
            ? selectedIndexes.map(i => selections[i]).filter(s => filtered.includes(s))
            : filtered;

        if (toExport.length === 0) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let content = '';
        const getFolderName = (s) => {
            const f = folders.find(f => f.id === s.folderId);
            return f ? f.name : 'Uncategorized';
        };

        switch (format) {
            case 'json':
                content = JSON.stringify(toExport.map(s => ({
                    text: s.text,
                    url: s.url,
                    captured: formatTime(s.timestamp),
                    starred: s.starred,
                    collection: getFolderName(s),
                    tags: s.tags || []
                })), null, 2);
                break;
            case 'csv': {
                const header = '"text","url","timestamp","starred","folder","tags"';
                const rows = toExport.map(s =>
                    `"${s.text.replace(/"/g, '""')}","${s.url}","${s.timestamp}","${s.starred}","${getFolderName(s)}","${(s.tags || []).join('; ')}"`
                );
                content = header + '\n' + rows.join('\n');
                break;
            }
            case 'md':
                content = toExport.map(s =>
                    `> ${s.text}\n\n*Source: ${s.url}*  \n*Tags: ${(s.tags || []).join(', ') || 'none'}*`
                ).join('\n\n---\n\n');
                break;
            default:
                content = toExport.map(s => s.text).join('\n\n---\n\n');
        }

        downloadFile(content, `archive-export-${timestamp}.${format}`, getMimeType(format));
    }

    function exportFolder(folderId) {
        const format = document.getElementById('exportFormat').value;
        const toExport = selections.filter(s => s.folderId === folderId);
        if (toExport.length === 0) return;
        const folder = folders.find(f => f.id === folderId);
        const name = folder ? folder.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() : 'collection';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let content = '';
        const getFolderName = (s) => {
            const f = folders.find(f => f.id === s.folderId);
            return f ? f.name : 'Uncategorized';
        };
        switch (format) {
            case 'json':
                content = JSON.stringify(toExport.map(s => ({
                    text: s.text, url: s.url, captured: formatTime(s.timestamp),
                    starred: s.starred, collection: getFolderName(s), tags: s.tags || []
                })), null, 2);
                break;
            case 'csv': {
                const header = '"text","url","timestamp","starred","folder","tags"';
                const rows = toExport.map(s =>
                    `"${s.text.replace(/"/g, '""')}","${s.url}","${s.timestamp}","${s.starred}","${getFolderName(s)}","${(s.tags || []).join('; ')}"`
                );
                content = header + '\n' + rows.join('\n');
                break;
            }
            case 'md':
                content = toExport.map(s =>
                    `> ${s.text}\n\n*Source: ${s.url}*  \n*Tags: ${(s.tags || []).join(', ') || 'none'}*`
                ).join('\n\n---\n\n');
                break;
            default:
                content = toExport.map(s => s.text).join('\n\n---\n\n');
        }
        downloadFile(content, `archive-${name}-${timestamp}.${format}`, getMimeType(format));
    }

    function clearSelections() {
        const filtered = getFilteredSelections();
        const toDelete = selectedIndexes.length > 0
            ? selectedIndexes.map(i => selections[i]).filter(s => filtered.includes(s))
            : filtered;

        if (toDelete.length === 0) return;
        const msg = toDelete.length === selections.length
            ? 'Delete all selections?'
            : `Delete ${toDelete.length} selection${toDelete.length > 1 ? 's' : ''}?`;

        if (confirm(msg)) {
            const ids = toDelete.map(s => s.id);
            selections = selections.filter(s => !ids.includes(s.id));
            selectedIndexes = [];
            focusIndex = -1;
            chrome.runtime.sendMessage({ type: 'setSelections', selections }, () => {
                renderAll();
                updateTagDisplay();
            });
        }
    }

    function loadSelections() {
        focusIndex = -1;
        chrome.storage.local.get(['selections', 'isCapturing'], (result) => {
            if (chrome.runtime.lastError) return;
            selections = result.selections || [];
            selections.forEach((s, i) => {
                if (!s.tags) s.tags = [];
                if (!s.id) s.id = 'sel_' + Date.now() + '_' + i;
                if (!s.folderId) s.folderId = 'default';
            });
            renderAll();
            updateCaptureStatus(result.isCapturing);
            updateTagDisplay();
        });
    }

    function setupDarkMode() {
        if (localStorage.getItem(storageKey('darkmode')) === 'true') {
            document.body.classList.add('dark-mode');
        }
    }

    function addTagToSelected() {
        const filtered = getFilteredSelections();
        const ids = selectedIndexes.length > 0
            ? selectedIndexes.map(i => selections[i]).filter(s => filtered.includes(s)).map(s => s.id)
            : [];

        if (ids.length === 0) {
            alert('Select items to tag');
            return;
        }

        pendingTagSelectionIds = ids;
        tagInput.value = '';
        tagInputOverlay.classList.remove('hidden');
        setTimeout(() => tagInput.focus(), 100);
    }

    const folderDialogStyle = document.createElement('style');
    folderDialogStyle.textContent = `
        .folder-opt:last-child { border-bottom: none !important; }
        .folder-opt:hover { background: var(--bg-hover) !important; }
    `;
    document.head.appendChild(folderDialogStyle);

    function setupEventListeners() {
        exportBtn.addEventListener('click', exportSelections);
        clearBtn.addEventListener('click', clearSelections);
        optionsLink.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openOptions' }));
        tagSelectedBtn.addEventListener('click', addTagToSelected);

        darkModeBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            localStorage.setItem(storageKey('darkmode'), document.body.classList.contains('dark-mode'));
        });

        createFolderBtn.addEventListener('click', () => showFolderDialog());

        searchInput.addEventListener('input', () => {
            clearSearchBtn.classList.toggle('hidden', !searchInput.value);
            focusIndex = -1;
            renderSelections();
        });

        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearSearchBtn.classList.add('hidden');
            focusIndex = -1;
            renderSelections();
            searchInput.focus();
        });

        document.getElementById('sortSelect').addEventListener('change', (e) => {
            sortBy = e.target.value;
            localStorage.setItem(storageKey('sort'), sortBy);
            renderSelections();
        });

        clearTagFilterBtn.addEventListener('click', () => {
            activeTagFilter = null;
            clearTagFilterBtn.classList.add('hidden');
            renderSelections();
            updateTagDisplay();
        });

        helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
        closeHelpBtn.addEventListener('click', () => helpModal.classList.add('hidden'));
        helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.add('hidden'); });

        statsToggle.addEventListener('click', () => {
            statsBar.classList.toggle('hidden');
            updateStats();
        });

        dismissOnboarding.addEventListener('click', () => {
            onboardingModal.classList.add('hidden');
            localStorage.setItem(storageKey('onboarding-done'), 'true');
        });
        onboardingModal.addEventListener('click', (e) => { if (e.target === onboardingModal) onboardingModal.classList.add('hidden'); });

        tagInputCancel.addEventListener('click', () => tagInputOverlay.classList.add('hidden'));
        tagInputSave.addEventListener('click', () => {
            const tag = tagInput.value.trim().toLowerCase().replace(/\s+/g, '-');
            if (!tag) return;
            chrome.runtime.sendMessage({ type: 'bulkAddTag', selectionIds: pendingTagSelectionIds, tag }, () => {
                selections.forEach(s => {
                    if (pendingTagSelectionIds.includes(s.id)) {
                        if (!s.tags) s.tags = [];
                        if (!s.tags.includes(tag)) s.tags.push(tag);
                    }
                });
                tagInputOverlay.classList.add('hidden');
                renderSelections();
                updateTagDisplay();
            });
        });
        tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tagInputSave.click(); if (e.key === 'Escape') tagInputOverlay.classList.add('hidden'); });
        tagInputOverlay.addEventListener('click', (e) => { if (e.target === tagInputOverlay) tagInputOverlay.classList.add('hidden'); });

        folderList.addEventListener('click', (e) => {
            const item = e.target.closest('li');
            if (!item) return;

            if (e.target.closest('.edit-folder')) {
                const fid = item.dataset.folderId;
                const f = folders.find(f => f.id === fid);
                if (f) showFolderDialog(f);
                return;
            }

            if (e.target.closest('.delete-folder')) {
                const fid = item.dataset.folderId;
                const f = folders.find(f => f.id === fid);
                if (f && confirm(`Delete "${f.name}"? Items move to Uncategorized.`)) {
                    chrome.runtime.sendMessage({ type: 'deleteFolder', folderId: fid }, (resp) => {
                        if (resp.success) {
                            if (currentFolderId === fid) currentFolderId = 'all';
                            loadFolders(() => loadSelections());
                        }
                    });
                }
                return;
            }

            if (e.target.closest('.pin-folder')) {
                togglePinFolder(item.dataset.folderId);
                return;
            }

            if (e.target.closest('.export-folder-btn')) {
                const fid = item.dataset.folderId;
                const f = folders.find(f => f.id === fid);
                if (f) exportFolder(f.id);
                return;
            }

            currentFolderId = item.dataset.folderId;
            folderList.querySelectorAll('li').forEach(li => li.classList.toggle('active', li === item));
            const targetId = currentFolderId === 'all' ? 'default' : currentFolderId;
            chrome.runtime.sendMessage({ type: 'setActiveFolderId', folderId: targetId });
            focusIndex = -1;
            renderSelections();
            renderFolders();
        });

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!helpModal.classList.contains('hidden') || !tagInputOverlay.classList.contains('hidden') || document.getElementById('folderDialog')) return;

            const filtered = getFilteredSelections();
            if (filtered.length === 0) return;

            switch (e.key) {
                case 'j':
                case 'ArrowDown':
                    e.preventDefault();
                    if (focusIndex < 0) focusIndex = selections.indexOf(filtered[0]);
                    else {
                        const curPos = filtered.indexOf(selections[focusIndex]);
                        const nextPos = Math.min(curPos + 1, filtered.length - 1);
                        focusIndex = selections.indexOf(filtered[nextPos]);
                    }
                    if (focusIndex >= 0) {
                        const el = document.querySelector(`.selection-item[data-index="${focusIndex}"]`);
                        if (el) el.scrollIntoView({ block: 'nearest' });
                    }
                    renderSelections();
                    break;
                case 'k':
                case 'ArrowUp':
                    e.preventDefault();
                    if (focusIndex < 0) focusIndex = selections.indexOf(filtered[0]);
                    else {
                        const curPos = filtered.indexOf(selections[focusIndex]);
                        const prevPos = Math.max(curPos - 1, 0);
                        focusIndex = selections.indexOf(filtered[prevPos]);
                    }
                    if (focusIndex >= 0) {
                        const el = document.querySelector(`.selection-item[data-index="${focusIndex}"]`);
                        if (el) el.scrollIntoView({ block: 'nearest' });
                    }
                    renderSelections();
                    break;
                case 's':
                    if (focusIndex >= 0) {
                        selections[focusIndex].starred = !selections[focusIndex].starred;
                        chrome.runtime.sendMessage({ type: 'setSelections', selections }, () => renderSelections());
                    }
                    break;
                case '/':
                    e.preventDefault();
                    searchInput.focus();
                    break;
                case 'e':
                    exportSelections();
                    break;
                case 'd':
                case 'Delete':
                    clearSelections();
                    break;
                case ' ':
                    e.preventDefault();
                    if (focusIndex >= 0) toggleSelection(focusIndex);
                    break;
                case 'Escape':
                    if (searchInput.value) {
                        searchInput.value = '';
                        clearSearchBtn.classList.add('hidden');
                        renderSelections();
                    }
                    break;
            }
        });

        window.addEventListener('beforeunload', () => {
            if (statusCheckInterval) clearInterval(statusCheckInterval);
        });
    }

    init();
});