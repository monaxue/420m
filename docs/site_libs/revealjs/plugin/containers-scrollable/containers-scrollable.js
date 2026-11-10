/**
 * Containers Theme scrollable slide helper for reveal.js
 *
 * Reveal.js + Quarto >= 1.10 add the .center class to every slide when
 * center: true. Quarto only marks slides with <ol> elements as .scrollable,
 * so slides with only bullet lists or ggplot figures can overflow without
 * scrolling. This plugin watches the active slide and adds .scrollable when
 * its content exceeds the slide frame.
 */
window.ContainersScrollable = function () {
  return {
    id: "ContainersScrollable",
    init: function (deck) {
      function getFrameHeight() {
        if (deck.getComputedSlideSize) {
          try {
            return deck.getComputedSlideSize().height;
          } catch (e) {
            // fall through
          }
        }
        var cfg = deck.getConfig && deck.getConfig();
        return (cfg && cfg.height) || 700;
      }

      function inSpecialView() {
        if (deck.isScrollView) {
          try {
            return deck.isScrollView();
          } catch (e) {
            // fall through
          }
        }
        if (deck.isPrintView) {
          try {
            return deck.isPrintView();
          } catch (e) {
            // fall through
          }
        }
        return false;
      }

      function markSlide(slide) {
        if (!slide) return;
        if (!slide.classList.contains("center")) return;
        if (slide.classList.contains("scrollable")) return;
        if (slide.classList.contains("stack")) return;
        if (inSpecialView()) return;

        var frame = getFrameHeight();
        if (slide.scrollHeight > frame + 2) {
          slide.classList.add("scrollable");
          if (deck.layout) {
            deck.layout();
          }
        }
      }

      var ro = new ResizeObserver(function (entries) {
        var current = deck.getCurrentSlide();
        if (!current) return;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].target === current) {
            markSlide(current);
            return;
          }
        }
      });

      function observeCurrent() {
        ro.disconnect();
        var slide = deck.getCurrentSlide();
        if (slide) {
          ro.observe(slide);
          markSlide(slide);
        }
      }

      if (deck.isReady && deck.isReady()) {
        observeCurrent();
      } else {
        deck.on("ready", observeCurrent);
      }
      deck.on("slidechanged", observeCurrent);
    }
  };
};
