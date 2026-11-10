-- containers-bake.lua
-- Bakes per-slide container colors into revealjs HTML at render time.
-- Derives a three-color scale (--color-1/2/3) from each slide's effective
-- data-background-color using spec OKLab/OKLCH math, then injects a static
-- <style> block. The rendered presentation contains only literal rgba values
-- -- no runtime JS, no browser engine color-math dependencies.
-- Also bakes matching :has(.present) rules for the simplemenu bar.

local function trim(s)
  return (s:gsub("^%s*(.-)%s*$", "%1"))
end

local function cbrt(x)
  if x >= 0 then
    return x ^ (1 / 3)
  else
    return -((-x) ^ (1 / 3))
  end
end

local function srgb_to_lin(c)
  c = c / 255
  if c <= 0.04045 then
    return c / 12.92
  else
    return ((c + 0.055) / 1.055) ^ 2.4
  end
end

local function lin_to_srgb(c)
  if c <= 0.0031308 then
    return c * 12.92
  else
    return 1.055 * (c ^ (1 / 2.4)) - 0.055
  end
end

local function oklab_from_rgb(r, g, b)
  r, g, b = srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b)
  local l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  local m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  local s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  local l_, m_, s_ = cbrt(l), cbrt(m), cbrt(s)
  local L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  local a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  local b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  return L, a, b2
end

local function oklch_to_srgb(L, C, H)
  local h = math.rad(H)
  local a, b2 = C * math.cos(h), C * math.sin(h)
  local l_ = L + 0.3963377774 * a + 0.2158037573 * b2
  local m_ = L - 0.1055613458 * a - 0.0638541728 * b2
  local s_ = L - 0.0894841775 * a - 1.2914855480 * b2
  local l, m, s = l_ ^ 3, m_ ^ 3, s_ ^ 3
  local r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  local g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  local b2out = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  r = math.max(0, math.min(1, r))
  g = math.max(0, math.min(1, g))
  b2out = math.max(0, math.min(1, b2out))
  return lin_to_srgb(r), lin_to_srgb(g), lin_to_srgb(b2out)
end

local function parse_oklch(s)
  if not s then return nil end
  s = trim(s)
  if not s:lower():match("^oklch%s*%(") then
    return nil
  end
  local vals = {}
  for num in s:gmatch("(%d+%.?%d*)") do
    table.insert(vals, tonumber(num))
  end
  if #vals < 3 then
    return nil
  end
  local L, C, H = vals[1], vals[2], vals[3]
  -- Accept percentage form for L
  if L > 1 then
    L = L / 100
  end
  return L, C, H
end

local function parse_color(s)
  if not s then return nil end
  s = trim(s)
  if s:sub(1, 1) == "#" then
    local hex = s:sub(2)
    if #hex == 3 then
      local r = tonumber(hex:sub(1, 1) .. hex:sub(1, 1), 16)
      local g = tonumber(hex:sub(2, 2) .. hex:sub(2, 2), 16)
      local b = tonumber(hex:sub(3, 3) .. hex:sub(3, 3), 16)
      if r and g and b then return r, g, b end
    elseif #hex == 6 then
      local r = tonumber(hex:sub(1, 2), 16)
      local g = tonumber(hex:sub(3, 4), 16)
      local b = tonumber(hex:sub(5, 6), 16)
      if r and g and b then return r, g, b end
    end
  else
    -- Reject other CSS color functions (hsl, oklab, lch, color, etc.)
    local func = s:match("^[%s]*([a-zA-Z]+)%s*%(")
    if func and func:lower() ~= "rgb" and func:lower() ~= "rgba" then
      return nil
    end
    local vals = {}
    for num in s:gmatch("(%d+%.?%d*)") do
      table.insert(vals, tonumber(num))
    end
    if #vals >= 3 then
      local r, g, b = vals[1], vals[2], vals[3]
      -- Validate range to catch mis-parsed non-RGB functions
      if r >= -0.001 and r <= 255.001 and g >= -0.001 and g <= 255.001 and b >= -0.001 and b <= 255.001 then
        return r, g, b
      end
    end
  end
  return nil
end

local function derive_color(bg_str, steps)
  steps = steps or 1
  -- First try oklch() input (e.g. oklch(0.9683 0.0688 87.6))
  local L, C, H = parse_oklch(bg_str)
  if L then
    local L2 = L - 0.07 * steps
    local C2
    if C < 0.005 then
      C2 = 0
    else
      C2 = C + 0.04 * steps
    end
    local nr, ng, nb = oklch_to_srgb(L2, C2, H)
    return string.format("rgba(%d, %d, %d, 1)",
      math.floor(nr * 255 + 0.5),
      math.floor(ng * 255 + 0.5),
      math.floor(nb * 255 + 0.5))
  end

  local r, g, b = parse_color(bg_str)
  if not r then
    quarto.log.warning("containers-bake: could not parse color '" .. tostring(bg_str) .. "'; using white fallback")
    r, g, b = 255, 255, 255
  end
  local L, a, b_ = oklab_from_rgb(r, g, b)
  local C = math.sqrt(a * a + b_ * b_)
  local H = math.deg(math.atan(b_, a)) % 360
  local L2 = L - 0.07 * steps
  local C2
  if C < 0.005 then
    C2 = 0
  else
    C2 = C + 0.04 * steps
  end
  local nr, ng, nb = oklch_to_srgb(L2, C2, H)
  return string.format("rgba(%d, %d, %d, 1)",
    math.floor(nr * 255 + 0.5),
    math.floor(ng * 255 + 0.5),
    math.floor(nb * 255 + 0.5))
end

local function css_escape_id(s)
  -- Pandoc auto-identifiers can contain periods; in a CSS id selector a '.'
  -- is a class separator, so it must be escaped. Defensively also hex-escape
  -- a leading digit (invalid at the start of a CSS identifier).
  local first = s:sub(1, 1)
  if first:match("%d") then
    s = "\\" .. string.format("%x ", first:byte()) .. s:sub(2)
  end
  return (s:gsub("%.", "\\."))
end

function Pandoc(doc)
  if not quarto.format.is_revealjs_output() then
    return doc
  end

  local defaultBg = "#ffffff"
  local m = nil
  if quarto.metadata and quarto.metadata.get then
    m = quarto.metadata.get("containers-bg-default")
  end
  if m == nil then
    m = doc.meta["containers-bg-default"]
  end
  if m then
    defaultBg = pandoc.utils.stringify(m)
  end

  -- Resolve any user-specified title-slide background
  local titleBg = nil
  local tsa = doc.meta["title-slide-attributes"]
  if tsa then
    local mt = pandoc.utils.type(tsa)
    if mt == "MetaMap" or type(tsa) == "table" then
      local dc = tsa["data-background-color"]
      local bc = tsa["background-color"]
      if dc then titleBg = pandoc.utils.stringify(dc) end
      if not titleBg and bc then titleBg = pandoc.utils.stringify(bc) end
    end
  end

  -- Determine whether a title slide will actually be rendered
  local hasTitle = false
  local titleMeta = doc.meta["title"]
  if titleMeta then
    local tstr = pandoc.utils.stringify(titleMeta)
    if tstr and tstr ~= "" then hasTitle = true end
  end

  -- If no title-slide background is specified, inject containers-bg-default so the
  -- title slide matches the rest of the deck; otherwise honor the user's color.
  local effectiveTitleBg = defaultBg
  if titleBg and trim(titleBg) ~= "" then
    effectiveTitleBg = titleBg
  elseif hasTitle then
    if not tsa or not (pandoc.utils.type(tsa) == "MetaMap" or type(tsa) == "table") then
      tsa = pandoc.MetaMap({})
      doc.meta["title-slide-attributes"] = tsa
    end
    tsa["data-background-color"] = defaultBg
  end

  -- Start the slide-to-slide inheritance chain from the effective title slide color
  -- (or from the default when there is no title slide).
  local lastBg = effectiveTitleBg

  local rules = {}

  -- Title slide is generated by the revealjs writer from metadata, so target it by id.
  local titleDerived1 = derive_color(effectiveTitleBg, 1)
  local titleDerived2 = derive_color(effectiveTitleBg, 4)
  table.insert(rules, string.format(
    "#title-slide { --color-1: %s; --color-2: %s; --color-3: %s; }",
    effectiveTitleBg, titleDerived1, titleDerived2))
  table.insert(rules, string.format(
    "body:has(#title-slide.present) .reveal > .menubar.top { background-color: %s; --color-3: %s; }",
    titleDerived1, titleDerived2))
  table.insert(rules, string.format(
    "body:has(#title-slide.present) { background-color: %s; }", effectiveTitleBg))

  -- Viewport fallback: covers writer-generated slides without data-background-color
  -- (TOC, refs, empty headerless slides) and the area behind transparent backgrounds.
  table.insert(rules, string.format(".reveal-viewport { background-color: %s; }", effectiveTitleBg))

  -- Only slide-level headers participate in the background chain (avoid h3+ content
  -- headings inside a slide injecting attributes or poisoning lastBg).
  local slideLevel = 2
  local slMeta = doc.meta["slide-level"]
  if slMeta then
    local slNum = tonumber(pandoc.utils.stringify(slMeta))
    if slNum and slNum > 0 then slideLevel = math.floor(slNum) end
  end

  -- Walk the document linearly, splitting it into slides the same way pandoc does:
  -- each slide-level header and each HorizontalRule starts a new slide. Headerless
  -- segments (leading content, or content after an HR with no following header)
  -- get a marker div + a section.slide:has(...) rule that paints them with the
  -- current inherited background color.
  local newBlocks = {}
  local headerlessBlocks = {}
  local mode = "headerless"  -- "headerless" = accumulating a headerless segment; "header" = inside a header slide
  local markerCount = 0

  local function flushHeaderless()
    if #headerlessBlocks > 0 then
      markerCount = markerCount + 1
      local markerId = "containers-bake-hls-" .. markerCount
      local markerAttr = pandoc.Attr(markerId, {}, { ["data-containers-bg"] = lastBg })
      table.insert(newBlocks, pandoc.Div({}, markerAttr))
      for _, b in ipairs(headerlessBlocks) do
        table.insert(newBlocks, b)
      end
      local derived1 = derive_color(lastBg, 1)
      local derived2 = derive_color(lastBg, 4)
      table.insert(rules, string.format(
        "section.slide:has(> #%s) { --color-1: %s; --color-2: %s; --color-3: %s; }",
        css_escape_id(markerId), lastBg, derived1, derived2))
      table.insert(rules, string.format(
        "body:has(section.slide.present > #%s) .reveal > .menubar.top { background-color: %s; --color-3: %s; }",
        css_escape_id(markerId), derived1, derived2))
      table.insert(rules, string.format(
        "body:has(section.slide.present > #%s) { background-color: %s; }",
        css_escape_id(markerId), lastBg))
    end
    headerlessBlocks = {}
  end

  local function handleHeader(el)
    local bg = el.attr.attributes["data-background-color"] or el.attr.attributes["background-color"]
    if bg then bg = trim(tostring(bg)) end
    if not bg or bg == "" then
      bg = lastBg
      el.attr.attributes["data-background-color"] = bg
    else
      lastBg = bg
    end
    local derived1 = derive_color(bg, 1)
    local derived2 = derive_color(bg, 4)
    if el.attr.identifier and el.attr.identifier ~= "" then
      local escId = css_escape_id(el.attr.identifier)
      table.insert(rules, string.format(
        "#%s { --color-1: %s; --color-2: %s; --color-3: %s; }", escId, bg, derived1, derived2))
      table.insert(rules, string.format(
        "body:has(#%s.present) .reveal > .menubar.top { background-color: %s; --color-3: %s; }",
        escId, derived1, derived2))
      table.insert(rules, string.format(
        "body:has(#%s.present) { background-color: %s; }", escId, bg))
    else
      quarto.log.warning("containers-bake: slide header has no identifier; cannot bake container color for it")
    end
    table.insert(newBlocks, el)
  end

  for _, block in ipairs(doc.blocks) do
    if block.t == "Header" and block.level <= slideLevel then
      flushHeaderless()
      handleHeader(block)
      mode = "header"
    elseif block.t == "HorizontalRule" then
      flushHeaderless()
      mode = "headerless"
      table.insert(newBlocks, block)
    else
      if mode == "header" then
        table.insert(newBlocks, block)
      else
        table.insert(headerlessBlocks, block)
      end
    end
  end
  flushHeaderless()

  doc.blocks = newBlocks

  local style = "<style>\n" .. table.concat(rules, "\n") .. "\n</style>"
  quarto.doc.include_text("in-header", style)

  -- Promote marker data-containers-bg to the parent <section>'s data-background-color
  -- so reveal.js paints a full-slide .slide-background instead of only coloring the
  -- content-height section box.
  local promoteScript = [[
<script>
(function () {
  function promoteContainerBackgrounds() {
    document.querySelectorAll('[data-containers-bg]').forEach(function (marker) {
      var section = marker.closest('section.slide');
      if (section) {
        section.setAttribute('data-background-color', marker.getAttribute('data-containers-bg'));
      }
    });
    // The reveal.js writer placed Reveal.initialize before this script, so sync
    // the deck so it rebuilds .slide-background elements from the updated attrs.
    if (typeof Reveal !== 'undefined' && typeof Reveal.sync === 'function') {
      Reveal.sync();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', promoteContainerBackgrounds);
  } else {
    promoteContainerBackgrounds();
  }

  // Re-layout once the page has fully loaded. The :has(.menubar.top) guard only
  // starts matching after simplemenu injects the bar, so reveal's first layout
  // was computed for a full-height .reveal. Re-layout rescales the deck to the
  // reserved strip and also updates the plugin's --simplemenu-scale value.
  window.addEventListener('load', function () {
    if (typeof Reveal !== 'undefined' && typeof Reveal.layout === 'function') {
      Reveal.layout();
    }
  });
})();
</script>
]]
  quarto.doc.include_text("after-body", promoteScript)

  return doc
end
