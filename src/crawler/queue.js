// src/crawler/queue.js

export class Queue {
  constructor() {
    this.items = [];
    this.seen = new Set(); // makes contains() O(1) instead of scanning the array
  }

  enqueue(item) {
    this.items.push(item);
    this.seen.add(item);
  }

  dequeue() {
    return this.items.shift();
  }

  isEmpty() {
    return this.items.length === 0;
  }

  contains(item) {
    return this.seen.has(item);
  }

  get size() {
    return this.items.length;
  }
}