---
layout: default
title: Cohorts
permalink: /cohorts/
---

<div class="cohorts-index">
    <header class="page-header">
        <h1>Cohorts</h1>
        <p class="page-subtitle">The MDAP internship program has been running for a while but we only started this showcase in 2026.</p>
    </header>

    {% include intern-entries.html %}
    {% assign cohort_entries = intern_entries %}
    {% assign grouped = cohort_entries | group_by: "cohort" | sort: "name" | reverse %}

    {% if grouped.size > 0 %}
        {% for cohort_group in grouped %}
        <section class="cohort">
            <h2>
                <a href="{{ '/cohorts/' | append: cohort_group.name | downcase | append: '/' | relative_url }}">
                    {{ cohort_group.name | replace: '-', ' ' }}
                </a>
            </h2>
            <ul class="intern-list">
                {% assign sorted_items = cohort_group.items | sort: "display_name" %}
                {% for intern in sorted_items %}
                    {% include intern-card.html intern=intern %}
                {% endfor %}
            </ul>
        </section>
        {% endfor %}
    {% else %}
        <p class="empty-state">No cohorts published yet &mdash; check back soon.</p>
    {% endif %}
</div>
