const utils = {
    escapeHtml(str) {
        const p = document.createElement('p');
        p.textContent = str;
        return p.innerHTML;
    },

    getDomainFromUrl(url) {
        try {
            return new URL(url).hostname;
        } catch (e) {
            return 'unknown source';
        }
    },

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleString();
    },

    downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    getMimeType(format) {
        switch (format) {
            case 'json': return 'application/json';
            case 'csv': return 'text/csv';
            case 'md': return 'text/markdown';
            default: return 'text/plain';
        }
    }
};

// Make it globally accessible
window.utils = utils;