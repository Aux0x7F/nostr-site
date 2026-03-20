import test from "node:test";
import assert from "node:assert/strict";

import {
  applyObservedMarkup,
  applyObservedText,
  createObservedRegionRouter
} from "../scripts/core/observed-regions.js";

test("observed region helpers avoid redundant writes", () => {
  const element = {
    _innerHTML: "<div>same</div>",
    _textContent: "same",
    markupWrites: 0,
    textWrites: 0,
    set innerHTML(value) {
      this._innerHTML = value;
      this.markupWrites += 1;
    },
    get innerHTML() {
      return this._innerHTML;
    },
    set textContent(value) {
      this._textContent = value;
      this.textWrites += 1;
    },
    get textContent() {
      return this._textContent;
    }
  };

  assert.equal(applyObservedMarkup(element, "<div>same</div>"), false);
  assert.equal(applyObservedText(element, "same"), false);
  assert.equal(applyObservedMarkup(element, "<div>next</div>"), true);
  assert.equal(applyObservedText(element, "next"), true);
  assert.equal(element.markupWrites, 1);
  assert.equal(element.textWrites, 1);
});

test("observed region router tracks cached values by region", () => {
  const element = {
    _innerHTML: "",
    writes: 0,
    set innerHTML(value) {
      this._innerHTML = value;
      this.writes += 1;
    },
    get innerHTML() {
      return this._innerHTML;
    }
  };

  const router = createObservedRegionRouter();
  const first = router.apply([{ name: "pane", kind: "markup", element, value: "<div>One</div>" }]);
  const second = router.apply([{ name: "pane", kind: "markup", element, value: "<div>One</div>" }]);
  const third = router.apply([{ name: "pane", kind: "markup", element, value: "<div>Two</div>" }]);

  assert.deepEqual([...first], ["pane"]);
  assert.deepEqual([...second], []);
  assert.deepEqual([...third], ["pane"]);
  assert.equal(element.writes, 2);
});
