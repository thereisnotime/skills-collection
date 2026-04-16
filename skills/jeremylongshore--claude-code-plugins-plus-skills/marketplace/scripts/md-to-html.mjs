#!/usr/bin/env node

/**
 * Shared markdown-to-HTML converter for marketplace build scripts.
 *
 * Used by:
 *   - discover-skills.mjs   (skill SKILL.md body content)
 *   - extract-readme-sections.mjs  (plugin README sections)
 *
 * Handles: fenced code blocks (with lang attribute), tables, headings h1-h6,
 * horizontal rules, ordered/unordered lists, bold, italic, inline code, links.
 * Zero runtime dependencies.
 */

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inlineFormat(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

/**
 * Convert a markdown string to HTML.
 *
 * Supports fenced code blocks (with optional language tag rendered as
 * `data-lang`), GFM-style pipe tables, headings (h1–h6), horizontal rules,
 * ordered and unordered lists, and inline formatting (bold, italic, code,
 * links).
 */
export function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inCodeBlock = false;
  let inList = false;
  let listType = null;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        out.push('</code></pre>');
        inCodeBlock = false;
      } else {
        if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
        if (inTable) { out.push('</tbody></table>'); inTable = false; }
        const lang = line.trim().slice(3).trim();
        out.push(`<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>`);
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(escapeHtml(line));
      continue;
    }

    const trimmed = line.trim();

    // Table rows (detect by pipe characters)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());

      // Separator row (|---|---|)
      if (cells.every(c => /^[-:]+$/.test(c))) {
        continue;
      }

      if (!inTable) {
        if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
        out.push('<table><thead><tr>');
        cells.forEach(c => out.push(`<th>${inlineFormat(c)}</th>`));
        out.push('</tr></thead><tbody>');
        inTable = true;
        continue;
      }

      out.push('<tr>');
      cells.forEach(c => out.push(`<td>${inlineFormat(c)}</td>`));
      out.push('</tr>');
      continue;
    }

    // Close table if we hit a non-table line
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }

    // Empty line
    if (!trimmed) {
      if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
      continue;
    }

    // Headings (h1-h6)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
      out.push('<hr>');
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmed)) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(`</${listType}>`);
        out.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${inlineFormat(trimmed.replace(/^[-*+]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(trimmed)) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(`</${listType}>`);
        out.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${inlineFormat(trimmed.replace(/^\d+[.)]\s+/, ''))}</li>`);
      continue;
    }

    // Paragraph
    if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
    out.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  if (inList) out.push(`</${listType}>`);
  if (inCodeBlock) out.push('</code></pre>');
  if (inTable) out.push('</tbody></table>');

  return out.join('\n');
}
