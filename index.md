---
layout: default
title: Intern Showcase
---

<h1>Our Interns</h1>
<ul>
{% for page in site.pages %}
  {% if page.path contains 'interns/' %}
    <div class="card">
      <a href="{{ page.url }}">{{ page.title }}</a>
      <p>{{ page.role }}</p>
      <p>{{ page.tags | join: ', ' }}</p>
    </div>
  {% endif %}
{% endfor %}
</ul>