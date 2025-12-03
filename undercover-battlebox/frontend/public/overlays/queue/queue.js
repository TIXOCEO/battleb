import { initEventRouter } from "/overlays/shared/event-router.js";
import { useQueueStore } from "/overlays/shared/stores.js";

initEventRouter();

const grid = document.getElementById("queue-grid");

// Create 30 fixed card containers
const cards = Array.from({ length: 30 }, () => {
  const c = document.createElement("div");
  c.className = "bb-card empty-card";
  return c;
});
cards.forEach((c) => grid.appendChild(c));

const EMPTY_AVATAR = "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

useQueueStore.subscribe((state) => {
  const entries = state.entries || [];
  const highlight = state.lastUpdatedId;

  for (let i = 0; i < 30; i++) {
    const el = cards[i];
    const entry = entries[i];

    // ============================================
    // FREE SPOT
    // ============================================
    if (!entry) {
      el.className = "bb-card empty-card";

      el.innerHTML = `
        <div class="pos-badge">${i + 1}</div>

        <div class="card-avatar" style="background-image:url('${EMPTY_AVATAR}')"></div>

        <div class="card-info">
          <div class="name">VRIJ</div>
          <div class="user"></div>
        </div>
      `;
      continue;
    }

    // ============================================
    // FILLED SPOT
    // ============================================
    el.className = "bb-card";

    if (entry.is_vip) el.classList.add("vip-glow");

    if (highlight && highlight === entry.username) {
      el.classList.add("card-update");
      setTimeout(() => el.classList.remove("card-update"), 650);
    }

    const avatar = entry.avatar_url || EMPTY_AVATAR;

    el.innerHTML = `
      <div class="pos-badge">${entry.position}</div>

      <div class="card-avatar" style="background-image:url('${avatar}')"></div>

      <div class="card-info">
        <div class="name">${entry.display_name}</div>
        <div class="user">@${entry.username}</div>
      </div>
    `;
  }
});
