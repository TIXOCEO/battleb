export const Store = {
  queue: [],
  recentEvents: [],
  twists: [],
  setQueue(entries) {
    this.queue = entries;
  },
  addEvent(evt) {
    this.recentEvents.unshift(evt);
    this.recentEvents = this.recentEvents.slice(0, 5);
  }
};
