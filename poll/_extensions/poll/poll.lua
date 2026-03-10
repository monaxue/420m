-- poll.lua
-- 1. Injects poll.js and poll.css into RevealJS output
-- 2. Preserves .poll and .freeresponse div classes so JS can find them
-- 3. Extracts question text into data-question attribute so JS can read it reliably
-- 4. Strips [answer: ...] lines and [correct] markers from rendered HTML
-- 5. Stores correct answer in data-correct-answer attribute
-- 6. Stores correct indices in data-correct-indices attribute

local function inject_assets(meta)
  if not quarto.doc.is_format("revealjs") then
    return meta
  end
  quarto.doc.add_html_dependency({
    name        = "poll",
    version     = "2.0.0",
    scripts     = { { path = "poll.js" } },
    stylesheets = { "poll.css" }
  })
  return meta
end

-- Strip [correct] from a list of inlines, return cleaned inlines + whether it was marked
local function strip_correct_inlines(inlines)
  local result = {}
  local had_correct = false
  for _, inline in ipairs(inlines) do
    if inline.t == "Str" then
      if inline.text:match("%[correct%]") then
        had_correct = true
        local cleaned = inline.text:gsub("%s*%[correct%]%s*", ""):gsub("^%s+",""):gsub("%s+$","")
        if cleaned ~= "" then table.insert(result, pandoc.Str(cleaned)) end
      else
        table.insert(result, inline)
      end
    elseif inline.t == "Space" then
      if #result > 0 then table.insert(result, inline) end
    else
      table.insert(result, inline)
    end
  end
  -- trim trailing spaces
  while #result > 0 and result[#result].t == "Space" do table.remove(result) end
  return result, had_correct
end

local function is_answer_line(block)
  return pandoc.utils.stringify(block):match("^%[answer:") ~= nil
end

local function handle_div(div)
  -- FORMAT is pandoc's built-in global; works at Div-filter time
  if not (FORMAT == "revealjs" or FORMAT == "html") then return div end

  local is_poll = div.classes:includes("poll")
  local is_fr   = div.classes:includes("freeresponse")
  if not (is_poll or is_fr) then return div end

  -- ── Extract metadata from content ────────────────────────────────────────

  -- 1. Question: first Para or Header that contains a Strong or is standalone text
  local question_text = ""
  for _, block in ipairs(div.content) do
    if block.t == "Para" or block.t == "Header" then
      if not is_answer_line(block) then
        question_text = pandoc.utils.stringify(block)
        break
      end
    end
  end

  -- 2. Correct answer (free response)
  local correct_answer = ""
  for _, block in ipairs(div.content) do
    local text = pandoc.utils.stringify(block)
    local m = text:match("%[answer:%s*(.-)%]")
    if m then correct_answer = m break end
  end

  -- 3. Correct indices (MC) — walk bullet list
  local correct_indices = {}
  local option_index = 0
  for _, block in ipairs(div.content) do
    if block.t == "BulletList" then
      for _, item in ipairs(block.content) do
        local item_text = pandoc.utils.stringify(item)
        if item_text:match("%[correct%]") then
          table.insert(correct_indices, option_index)
        end
        option_index = option_index + 1
      end
    end
  end

  -- ── Clean content ─────────────────────────────────────────────────────────

  local cleaned = pandoc.walk_block(div, {
    Para = function(para)
      if is_answer_line(para) then return {} end
      return para
    end,
    Plain = function(plain)
      if is_answer_line(plain) then return {} end
      return plain
    end,
    BulletList = function(list)
      local new_items = {}
      for _, item in ipairs(list.content) do
        local new_item = {}
        for _, block in ipairs(item) do
          if block.t == "Plain" or block.t == "Para" then
            local new_inlines, _ = strip_correct_inlines(block.content)
            table.insert(new_item, block.t == "Plain" and pandoc.Plain(new_inlines) or pandoc.Para(new_inlines))
          else
            table.insert(new_item, block)
          end
        end
        table.insert(new_items, new_item)
      end
      return pandoc.BulletList(new_items)
    end,
  })

  -- ── Extract options text for data-options attribute ─────────────────────

  local options_list = {}
  for _, block in ipairs(cleaned.content) do
    if block.t == "BulletList" then
      for _, item in ipairs(block.content) do
        local text = pandoc.utils.stringify(item):gsub("^%s+",""):gsub("%s+$","")
        -- JSON-escape: backslash, then quote
        text = text:gsub('\\', '\\\\'):gsub('"', '\\"')
        table.insert(options_list, '"' .. text .. '"')
      end
    end
  end

  -- ── Build output HTML ─────────────────────────────────────────────────────

  local inner = pandoc.write(pandoc.Pandoc(cleaned.content), "html")

  local class_str = is_fr and "freeresponse" or "poll"

  -- Build attributes string
  local attrs = 'class="' .. class_str .. '"'

  if div.attributes["data-timer"] then
    attrs = attrs .. ' data-timer="' .. div.attributes["data-timer"] .. '"'
  end
  if div.attributes["data-multi"] then
    attrs = attrs .. ' data-multi="' .. div.attributes["data-multi"] .. '"'
  end
  if question_text ~= "" then
    local q = question_text:gsub('"', '&quot;')
    attrs = attrs .. ' data-question="' .. q .. '"'
  end
  if correct_answer ~= "" then
    local a = correct_answer:gsub('"', '&quot;')
    attrs = attrs .. ' data-correct-answer="' .. a .. '"'
  end
  if #correct_indices > 0 then
    attrs = attrs .. ' data-correct-indices="' .. table.concat(correct_indices, ",") .. '"'
  end
  if #options_list > 0 then
    -- store as JSON array, use single quotes to wrap since content uses double quotes
    local opts_json = '[' .. table.concat(options_list, ",") .. ']'
    opts_json = opts_json:gsub('"', '&quot;')
    attrs = attrs .. ' data-options="' .. opts_json .. '"'
  end

  return pandoc.RawBlock("html", '<div ' .. attrs .. '>\n' .. inner .. '\n</div>')
end

return {
  { Meta = inject_assets },
  { Div  = handle_div    }
}