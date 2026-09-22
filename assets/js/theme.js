(function () {
    var STORAGE_KEY = 'mdap-theme';
    var root = document.documentElement;
    var toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    function getTheme() {
        return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    function setTheme(theme) {
        root.setAttribute('data-theme', theme);
        toggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {}
    }

    setTheme(getTheme());

    toggle.addEventListener('click', function () {
        setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
})();
