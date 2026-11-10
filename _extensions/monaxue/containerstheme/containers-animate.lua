-- containers-animate.lua
-- Part of the Containers Theme extension.
--
-- Enables revealjs auto-animate on every top-level level-1/2 slide heading
-- and gives each heading a stable, text-derived data-id so identical headings
-- pair/morph while different headings do not.
--
-- Why the after-body script is needed:
-- Quarto's handleSlideHeadingAttributes removes ALL attributes from the slide
-- heading element and re-stamps data-id="quarto-animate-title" whenever the
-- heading carried data-auto-animate. A data-id set in the AST would be wiped
-- from the <h2> before the page loads. The id is therefore set on the
-- <section> (which survives), then copied onto the heading by a tiny script
-- that runs after the DOM is parsed but before any slide transition.
--
-- Kill switch: set `containers-auto-animate: false` in document/project
-- metadata to disable the filter entirely.

local function trim(s)
  return (s:gsub("^%s*(.-)%s*$", "%1"))
end

function Pandoc(doc)
  if not quarto.format.is_revealjs_output() then
    return doc
  end

  -- Kill switch: containers-auto-animate: false disables the filter.
  local opt = nil
  if quarto.metadata and quarto.metadata.get then
    opt = quarto.metadata.get("containers-auto-animate")
  end
  if opt == nil then
    opt = doc.meta["containers-auto-animate"]
  end
  local disabled = (opt == false) or
    (type(opt) == "string" and trim(opt:lower()) == "false")
  if disabled then
    return doc
  end

  for _, block in ipairs(doc.blocks) do
    if block.t == "Header" and (block.level == 1 or block.level == 2) then
      block.attributes["auto-animate"] = "true"
      if not block.attributes["data-id"] then
        block.attributes["data-id"] = "qaa-" .. trim(pandoc.utils.stringify(block))
      end
    end
  end

  quarto.doc.include_text("after-body", [=[
<script>
(function () {
  document.querySelectorAll('section[data-auto-animate]').forEach(function (section) {
    var id = section.getAttribute('data-id');
    var heading = section.firstElementChild;
    if (id && heading && /^H[12]$/i.test(heading.tagName)) {
      heading.setAttribute('data-id', id);
    }
  });
})();
</script>
]=])

  return doc
end
