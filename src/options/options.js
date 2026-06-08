document.addEventListener('DOMContentLoaded', () => {
    function setupDarkMode() {
        if (localStorage.getItem('archive-darkmode') === 'true') {
            document.body.classList.add('dark-mode');
        }
    }

    setupDarkMode();
});