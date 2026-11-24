// SPDX-License-Identifier: MIT
// Keep the completion link in sync with the creator’s localized support panel.
export function supportAfterSuccess(container) {
    const primary = document.querySelector(".creator-card .support-primary");
    if (!primary) return;
    const link = primary.cloneNode(false);
    link.className = "support-thanks";
    link.textContent = primary.dataset.thanks + " ↗";
    container.append(link);
}
