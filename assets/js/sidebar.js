(function () {
    var sidebar = document.querySelector('.sidebar');
    var toggle = document.getElementById('nav-toggle');
    if (!sidebar || !toggle) return;

    // Only has a visible effect below the mobile breakpoint — on desktop the
    // toggle is hidden and the nav is always shown (see main.css).
    toggle.addEventListener('click', function () {
        var open = sidebar.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
})();
