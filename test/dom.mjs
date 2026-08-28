/**
 * A small hand-rolled DOM, just large enough to run the built content script.
 * Supports class / tag / id / attribute selectors, descendant combinators and
 * selector lists, plus the node operations the extension actually performs.
 */

class Style {
  constructor() {
    this.props = new Map();
  }
  setProperty(name, value) {
    this.props.set(name, String(value));
  }
  getPropertyValue(name) {
    return this.props.get(name) ?? "";
  }
  removeProperty(name) {
    this.props.delete(name);
  }
}

class ClassList {
  constructor(element) {
    this.element = element;
  }
  add(...names) {
    for (const name of names) this.element._classes.add(name);
    this.element.ownerDocument?._mutated("attributes");
  }
  remove(...names) {
    for (const name of names) this.element._classes.delete(name);
    this.element.ownerDocument?._mutated("attributes");
  }
  contains(name) {
    return this.element._classes.has(name);
  }
  toggle(name, force) {
    const has = this.contains(name);
    const next = force === undefined ? !has : force;
    if (next) this.add(name);
    else this.remove(name);
    return next;
  }
  get length() {
    return this.element._classes.size;
  }
}

function datasetFor(element) {
  const toAttr = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return new Proxy(
    {},
    {
      get: (_t, key) => (typeof key === "string" ? element.getAttribute(toAttr(key)) ?? undefined : undefined),
      set: (_t, key, value) => {
        element.setAttribute(toAttr(String(key)), String(value));
        return true;
      },
      deleteProperty: (_t, key) => {
        element.removeAttribute(toAttr(String(key)));
        return true;
      },
      has: (_t, key) => element.hasAttribute(toAttr(String(key))),
    },
  );
}

export class El {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.style = new Style();
    this._classes = new Set();
    this._text = "";
    this._listeners = new Map();
    this.classList = new ClassList(this);
    this.dataset = datasetFor(this);
    this.hidden = false;
  }

  get parentNode() {
    return this.parentElement;
  }

  get className() {
    return [...this._classes].join(" ");
  }

  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    this.ownerDocument?._mutated("attributes");
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get title() {
    return this.getAttribute("title") ?? "";
  }

  set title(value) {
    this.setAttribute("title", value);
  }

  get value() {
    return this.getAttribute("value") ?? "";
  }

  set value(v) {
    this.setAttribute("value", v);
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this._text = value === null || value === undefined ? "" : String(value);
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  get childNodes() {
    return this.children;
  }

  get nextSibling() {
    const siblings = this.parentElement?.children;
    if (!siblings) return null;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling() {
    const siblings = this.parentElement?.children;
    if (!siblings) return null;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  setAttribute(name, value) {
    const key = String(name);
    const val = String(value);
    if (key === "class") {
      this.className = val;
      return;
    }
    this.attributes.set(key, val);
  }

  getAttribute(name) {
    if (name === "class") return this.className;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    this.ownerDocument?._mutated();
    return child;
  }

  prepend(child) {
    return this.insertBefore(child, this.children[0] ?? null);
  }

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    child.remove();
    const index = this.children.indexOf(reference);
    child.parentElement = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    this.ownerDocument?._mutated();
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    this.ownerDocument?._mutated();
    return child;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  matches(selector) {
    return parseSelectorList(selector).some((parts) => matchChain(this, parts));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const list = parseSelectorList(selector);
    const found = [];
    for (const node of descendants(this)) {
      if (list.some((parts) => matchChain(node, parts))) found.push(node);
    }
    return found;
  }

  addEventListener(type, handler) {
    const handlers = this._listeners.get(type) ?? [];
    handlers.push(handler);
    this._listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = this._listeners.get(type) ?? [];
    this._listeners.set(
      type,
      handlers.filter((entry) => entry !== handler),
    );
  }

  dispatch(type, event = {}) {
    const payload = {
      type,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    for (const handler of this._listeners.get(type) ?? []) handler(payload);
  }

  click() {
    this.dispatch("click");
  }

  /** Test helper: the visible text of this element's own text node. */
  get ownText() {
    return this._text;
  }
}

function* descendants(root) {
  for (const child of [...root.children]) {
    yield child;
    yield* descendants(child);
  }
}

const selectorCache = new Map();

function parseSelectorList(selector) {
  const cached = selectorCache.get(selector);
  if (cached) return cached;
  const parsed = selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/).map(parseCompound));
  selectorCache.set(selector, parsed);
  return parsed;
}

function parseCompound(text) {
  const compound = { tag: null, id: null, classes: [], attrs: [] };
  const pattern = /^([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]/;
  let rest = text;
  while (rest.length > 0) {
    const match = pattern.exec(rest);
    if (!match) throw new Error(`unsupported selector fragment: ${text}`);
    if (match[1]) compound.tag = match[1].toUpperCase();
    else if (match[2]) compound.classes.push(match[2]);
    else if (match[3]) compound.id = match[3];
    else if (match[4]) compound.attrs.push({ name: match[4], op: match[5] ?? null, value: match[6] ?? "" });
    rest = rest.slice(match[0].length);
  }
  return compound;
}

function matchCompound(element, compound) {
  if (!element || !(element instanceof El)) return false;
  if (compound.tag && element.tagName !== compound.tag) return false;
  if (compound.id && element.id !== compound.id) return false;
  for (const name of compound.classes) {
    if (!element._classes.has(name)) return false;
  }
  for (const attr of compound.attrs) {
    const actual = element.getAttribute(attr.name);
    if (actual === null) return false;
    if (attr.op === null) continue;
    if (attr.op === "=" && actual !== attr.value) return false;
    if (attr.op === "^=" && !actual.startsWith(attr.value)) return false;
    if (attr.op === "$=" && !actual.endsWith(attr.value)) return false;
    if (attr.op === "*=" && !actual.includes(attr.value)) return false;
    if (attr.op === "~=" && !actual.split(/\s+/).includes(attr.value)) return false;
  }
  return true;
}

/** Right-to-left descendant matching. */
function matchChain(element, compounds) {
  if (!matchCompound(element, compounds[compounds.length - 1])) return false;
  let index = compounds.length - 2;
  let node = element.parentElement;
  while (index >= 0) {
    if (!node) return false;
    if (matchCompound(node, compounds[index])) index -= 1;
    node = node.parentElement;
  }
  return true;
}

export class Doc {
  constructor() {
    this._observers = [];
    this.root = new El("html", this);
    this.head = new El("head", this);
    this.body = new El("body", this);
    this.root.appendChild(this.head);
    this.root.appendChild(this.body);
    this.readyState = "complete";
    this.activeElement = null;
  }

  createElement(tag) {
    return new El(tag, this);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  querySelector(selector) {
    return this.root.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.root.querySelectorAll(selector);
  }

  addEventListener() {}

  /** Notify any connected MutationObserver, the way a real DOM would. */
  _mutated(kind = "childList") {
    for (const observer of this._observers) observer._notify(kind);
  }
}

export function makeMutationObserver(doc) {
  return class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      this.options = {};
      doc._observers.push(this);
    }
    observe(_target, options = {}) {
      this.connected = true;
      this.options = options;
    }
    disconnect() {
      this.connected = false;
    }
    takeRecords() {
      return [];
    }
    /** Only deliver what the observer actually subscribed to. */
    _notify(kind) {
      if (!this.connected) return;
      const options = this.options ?? {};
      if (kind === "childList" && !options.childList) return;
      if (kind === "attributes") {
        if (!options.attributes) return;
        const filter = options.attributeFilter;
        if (Array.isArray(filter) && !filter.includes("class")) return;
      }
      this.callback([], this);
    }
  };
}
