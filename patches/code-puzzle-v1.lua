-- code-puzzle.lua  v7
--
-- Usage in .qmd:
--
--   ::::: code-puzzle
--   ```
--   ::: static
--   SampleSize <- {{49 OR 12}}
--   SD <- {{49 OR 12}}
--   :::
--
--   simulated_means <- {{c()}}
--
--   ::: indent
--   for (experiment in {{AllExperiments}}){
--   simulated_data <- {{rnorm(n = SampleSize, mean = Mean, sd = SD)}}
--   simulated_means[experiment] <- mean(simulated_data)
--   }
--   :::
--
--   :::: flex
--   ::: free
--   ggplot({{{data=sampling_distribution, aes(x = Means)}}}) +
--       geom_histogram(binwidth=0.1)
--   :::
--   {{{summary_table <- sampling_distribution}}} %>% summarize(Mean={{mean(Means)}})
--   ::::
--
--   summary_table
--   ```
--   :::::
--
-- Slot syntax:
--   {{answer OR answer2}}   word-bank drag slot
--   {{{answer}}}            free-text input (whitespace-insensitive)
--
-- Section markers:
--   ::: static :::   each line fixed, not draggable
--   ::: free :::     all lines = ONE draggable block
--   :::: flex ::::   children draggable, order NOT graded
--   ::: indent :::   first line = header, last line = footer (glued),
--                    middle lines = individually draggable children
--
-- Blank lines dropped everywhere except inside ::: free :::.

-- ── JSON encoder ─────────────────────────────────────────────────────────────

local function json_encode(val)
  local t = type(val)
  if val == nil     then return "null" end
  if t == "boolean" then return val and "true" or "false" end
  if t == "number"  then return tostring(val) end
  if t == "string"  then
    return '"' .. val:gsub('\\','\\\\')
                     :gsub('"', '\\"')
                     :gsub('\n','\\n')
                     :gsub('\r','\\r')
                     :gsub('\t','\\t') .. '"'
  end
  if t == "table" then
    if #val > 0 then
      local p = {}
      for _, v in ipairs(val) do p[#p+1] = json_encode(v) end
      return "[" .. table.concat(p, ",") .. "]"
    else
      local p = {}
      for k, v in pairs(val) do
        p[#p+1] = json_encode(tostring(k)) .. ":" .. json_encode(v)
      end
      return "{" .. table.concat(p, ",") .. "}"
    end
  end
  return "null"
end

-- ── helpers ───────────────────────────────────────────────────────────────────

local _uid_n = 0
local function uid()
  _uid_n = _uid_n + 1
  math.randomseed(os.time() + _uid_n * 7919)
  return "cp" .. tostring(math.random(100000, 999999)) .. _uid_n
end

local function trim(s)
  return s:match("^%s*(.-)%s*$")
end

local function indent_level(s)
  return #(s:match("^( *)") or "")
end

local function match_marker(s)
  -- Matches symmetric markers: ::: keyword ::: or :::: keyword ::::
  return trim(s):match("^::+%s+([-a-zA-Z]+)%s+::+$")
end

local function match_open(s)
  -- Matches asymmetric open: :::: indent  OR symmetric: :::: indent ::::
  local t = trim(s)
  return t:match("^::+%s+([-a-zA-Z]+)%s+::+$")  -- symmetric
      or t:match("^::+%s+([-a-zA-Z]+)$")          -- asymmetric open (colons only on left)
end

local function match_close(s)
  -- Matches asymmetric close: ::::  (colons only, no keyword)
  return trim(s):match("^::+$") ~= nil
end

-- Parse a line and return its keyword (for symmetric) or nil.
-- Also detects if it's a bare-colon close marker.
local function parse_line_marker(s)
  local t = trim(s)
  local sym = t:match("^::+%s+([-a-zA-Z]+)%s+::+$")
  if sym then return sym, false end  -- keyword, is_close
  local asym_open = t:match("^::+%s+([-a-zA-Z]+)$")
  if asym_open then return asym_open, false end
  if t:match("^::+$") then return nil, true end  -- bare close
  return nil, false
end

-- ── slot parser ───────────────────────────────────────────────────────────────

local function parse_slots(line)
  local parts = {}
  local pos, len = 1, #line
  while pos <= len do
    local s3 = line:find("{{{", pos, true)
    local s2 = line:find("{{",  pos, true)
    local nxt
    if s3 and (not s2 or s3 <= s2) then nxt = s3 else nxt = s2 end
    if not nxt then
      local tail = line:sub(pos)
      if tail ~= "" then parts[#parts+1] = {type="text", value=tail} end
      break
    end
    if nxt > pos then
      parts[#parts+1] = {type="text", value=line:sub(pos, nxt-1)}
    end
    if nxt == s3 then
      local e = line:find("}}}", nxt+3, true)
      if e then
        local inner = trim(line:sub(nxt+3, e-1))
        local answers = {}
        for part in (inner .. " OR "):gmatch("(.-)%s+OR%s+") do
          local a = trim(part)
          if a ~= "" then answers[#answers+1] = a end
        end
        if #answers == 0 then answers = {inner} end
        parts[#parts+1] = {type="free", answers=answers}
        pos = e + 3
      else
        parts[#parts+1] = {type="text", value=line:sub(nxt)}
        break
      end
    else
      local e = line:find("}}", nxt+2, true)
      if e then
        local inner = trim(line:sub(nxt+2, e-1))
        local answers = {}
        for part in (inner .. " OR "):gmatch("(.-)%s+OR%s+") do
          local a = trim(part)
          if a ~= "" then answers[#answers+1] = a end
        end
        if #answers == 0 then answers = {inner} end
        parts[#parts+1] = {type="wb", answers=answers}
        pos = e + 2
      else
        parts[#parts+1] = {type="text", value=line:sub(nxt)}
        break
      end
    end
  end
  return parts
end

-- ── block parser ──────────────────────────────────────────────────────────────

local function parse_blocks(source)
  local lines = {}
  for line in (source .. "\n"):gmatch("([^\n]*)\n") do
    lines[#lines+1] = line
  end

  local wb_set, wb_list = {}, {}

  local function add_wb(ans)
    if not wb_set[ans] then
      wb_set[ans] = true
      wb_list[#wb_list+1] = ans
    end
  end

  local function parsed_line(raw)
    local parts = parse_slots(raw)
    for _, p in ipairs(parts) do
      if p.type == "wb" then
        for _, a in ipairs(p.answers) do add_wb(a) end
      end
    end
    return {indent=indent_level(raw), parts=parts}
  end

  local function make_block(kind, raw_lines)
    local b = {kind=kind, lines={}}
    for _, r in ipairs(raw_lines) do
      b.lines[#b.lines+1] = parsed_line(r)
    end
    return b
  end

  local parse_section
  parse_section = function(lines, start, stop_kw, flex_group, parent_id, depth)
    local blocks = {}
    local i = start
    depth = depth or 0

    local function emit(b)
      if flex_group then b.flexGroup   = flex_group end
      if parent_id  then b.parentId    = parent_id  end
      b.indentDepth = depth
      blocks[#blocks+1] = b
    end

    -- Returns true if line is a closing marker for the current stop_kw
    local function is_close(t)
      if stop_kw == nil then return false end
      local kw, bare = parse_line_marker(t)
      if bare then return true end           -- bare :::: closes any open section
      if kw == stop_kw then return true end  -- symmetric close matches keyword
      return false
    end

    -- Returns true if line is a closing marker for a given keyword
    local function is_close_for(t, kw_target)
      local kw, bare = parse_line_marker(t)
      if bare then return true end
      if kw == kw_target then return true end
      return false
    end

    while i <= #lines do
      local raw     = lines[i]
      local trimmed = trim(raw)

      if trimmed == "" then
        i = i + 1

      elseif is_close(trimmed) then
        i = i + 1
        break

      else
        local kw, bare = parse_line_marker(trimmed)

        if kw == "static" then
          i = i + 1
          local acc = {}
          while i <= #lines and not is_close_for(trim(lines[i]), "static") do
            if trim(lines[i]) ~= "" then acc[#acc+1] = lines[i] end
            i = i + 1
          end
          i = i + 1
          for _, sl in ipairs(acc) do
            emit(make_block("fixed", {sl}))
          end

        elseif kw == "free" then
          i = i + 1
          local acc = {}
          while i <= #lines and not is_close_for(trim(lines[i]), "free") do
            acc[#acc+1] = lines[i]
            i = i + 1
          end
          i = i + 1
          while #acc > 0 and trim(acc[1])    == "" do table.remove(acc, 1) end
          while #acc > 0 and trim(acc[#acc]) == "" do table.remove(acc)    end
          if #acc > 0 then emit(make_block("free", acc)) end

        elseif kw == "flex" then
          local fid = uid()
          i = i + 1
          local child_blocks, next_i = parse_section(
            lines, i, "flex", fid, parent_id, depth)
          i = next_i
          for _, cb in ipairs(child_blocks) do blocks[#blocks+1] = cb end

        elseif kw == "indent" or kw == "indent-include" then
          local start_outside = (kw == "indent")
          local open_kw = kw
          i = i + 1
          local acc = {}
          while i <= #lines and not is_close_for(trim(lines[i]), open_kw) do
            acc[#acc+1] = lines[i]
            i = i + 1
          end
          i = i + 1
          while #acc > 0 and trim(acc[1])    == "" do table.remove(acc, 1) end
          while #acc > 0 and trim(acc[#acc]) == "" do table.remove(acc)    end

          if #acc >= 1 then
            local indent_id  = uid()
            local header_raw = trim(acc[1])
            local footer_raw = (#acc >= 2) and trim(acc[#acc]) or nil
            local inner      = {}
            local last       = (#acc >= 2) and (#acc - 1) or 1
            for j = 2, last do inner[#inner+1] = acc[j] end

            local ib = {
              kind         = "indent",
              id           = indent_id,
              indentDepth  = depth,
              startOutside = start_outside,
              header       = parsed_line(header_raw),
              footer       = (footer_raw and footer_raw ~= "")
                               and parsed_line(footer_raw) or nil,
            }
            if flex_group then ib.flexGroup = flex_group end
            if parent_id  then ib.parentId  = parent_id  end
            blocks[#blocks+1] = ib

            if #inner > 0 then
              local child_blocks, _ = parse_section(
                inner, 1, nil, nil, indent_id, depth + 1)
              for _, cb in ipairs(child_blocks) do blocks[#blocks+1] = cb end
            end
          end

        else
          -- plain draggable line (includes bare content and unrecognised markers)
          emit(make_block("drag", {raw}))
          i = i + 1
        end
      end
    end

    return blocks, i
  end

  local blocks = parse_section(lines, 1, nil, nil, nil, 0)
  return blocks, wb_list
end

-- ── CSS ───────────────────────────────────────────────────────────────────────

local css_injected = false

local function make_css()
  return
[[<style>
.cpz *{box-sizing:border-box;margin:0;padding:0}
.cpz{font-family:monospace;font-size:13px;color:#222;padding:14px;
     border:1px solid #ddd;border-radius:6px;background:#fff;margin:10px 0}
.cpz-layout{display:grid;grid-template-columns:1fr 200px;gap:18px;align-items:start}
.cpz-col-label{font-size:10px;color:#999;text-transform:uppercase;
               letter-spacing:1px;margin-bottom:6px}
.cpz-linenums{padding:6px 0 6px 4px;font-family:monospace;
              background:#f8f8f8;border:1px solid #e0e0e0;
              border-right:none;border-radius:4px 0 0 4px;
              color:#bbb;text-align:right;user-select:none;min-width:30px}
.cpz-linenums div{height:32px;margin-bottom:2px;display:flex;align-items:center;
                  justify-content:flex-end;padding-right:6px;font-size:11px}
.cpz-code{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:0 4px 4px 0;
          padding:6px;font-family:monospace;font-size:12.5px;line-height:1;flex:1}
.cpz-row{display:flex;align-items:stretch;height:32px;margin-bottom:2px}
.cpz-gutter{width:22px;min-width:22px;display:flex;align-items:center;
            justify-content:center;color:#ccc;font-size:13px;cursor:grab;
            flex-shrink:0;user-select:none}
.cpz-gutter.no-drag{cursor:default;color:transparent}
.cpz-line{display:flex;align-items:center;flex-wrap:wrap;gap:3px;flex:1;
          padding:3px 6px;border-radius:3px;
          border:1px solid #e0e0e0;background:#fff;line-height:1.4}
.cpz-line.cpz-draggable{cursor:grab}
.cpz-line.cpz-draggable:active{cursor:grabbing}
.cpz-line.cpz-dragging{opacity:.35}
.cpz-line.cpz-drag-over-above{border-top:2px solid #2196f3!important}
.cpz-line.cpz-drag-over-below{border-bottom:2px solid #2196f3!important}
.cpz-line.cpz-correct{background:#f0fff0;border-color:#4caf50!important}
.cpz-line.cpz-incorrect{background:#fff0f0;border-color:#f44336!important}
.cpz-free-block{border:1px solid #ccc;border-radius:3px;
                margin-bottom:2px;cursor:grab;display:flex;flex-direction:column;
                background:#fff}
.cpz-free-block:active{cursor:grabbing}
.cpz-free-block.cpz-dragging{opacity:.35}
.cpz-free-block.cpz-drag-over-above{border-top:2px solid #2196f3}
.cpz-free-block.cpz-drag-over-below{border-bottom:2px solid #2196f3}
.cpz-free-block.cpz-correct{background:#f0fff0;border-color:#4caf50}
.cpz-free-block.cpz-incorrect{background:#fff0f0;border-color:#f44336}
.cpz-free-row{display:flex;align-items:center;gap:3px;padding:0 4px;height:32px}
.cpz-free-handle{width:22px;min-width:22px;text-align:center;color:#ccc;
                 font-size:13px;user-select:none;flex-shrink:0}
.cpz-free-line{display:flex;align-items:center;flex-wrap:wrap;gap:3px;line-height:1.4;flex:1}
.cpz-indent-wrap{margin-bottom:2px}
.cpz-indent-block{border:1px solid #c8c8c8;border-radius:3px;background:#f0f0f0;cursor:grab}
.cpz-indent-block:active{cursor:grabbing}
.cpz-indent-block.cpz-dragging{opacity:.35}
.cpz-indent-block.cpz-drag-over-above{border-top:2px solid #2196f3}
.cpz-indent-block.cpz-drag-over-below{border-bottom:2px solid #2196f3}
.cpz-indent-block.cpz-correct{background:#f0fff0;border-color:#4caf50}
.cpz-indent-block.cpz-incorrect{background:#fff0f0;border-color:#f44336}
.cpz-indent-header{display:flex;align-items:center;gap:3px;height:32px;
                   padding:3px 6px 3px 0;line-height:1.4;flex-wrap:wrap}
.cpz-indent-footer{display:flex;align-items:center;gap:3px;height:32px;
                   padding:3px 6px 3px 0;line-height:1.4;flex-wrap:wrap;
                   border-top:1px dashed #c8c8c8}
.cpz-indent-children{padding-left:16px;border-left:3px solid #d0d0d0;
                     margin:0 6px 4px 6px;display:flex;flex-direction:column;gap:2px}
.cpz-indent-dropzone{height:32px;margin-bottom:2px;border:1.5px dashed #ccc;border-radius:3px;
                     display:flex;align-items:center;justify-content:center;
                     color:#bbb;font-size:11px;font-family:monospace}
.cpz-indent-dropzone.cpz-drop-active{border-color:#2196f3;background:#e3f2fd;color:#2196f3}
.cpz-slot{display:inline-flex;align-items:center;justify-content:center;
          min-width:70px;padding:1px 5px;border:1.5px dashed #bbb;border-radius:3px;
          background:#fff;color:#aaa;font-family:monospace;font-size:12px;
          white-space:nowrap;vertical-align:middle;transition:border-color .1s,background .1s}
.cpz-slot.filled{border-style:solid;border-color:#888;color:#222;
                 background:#f0f0f0;cursor:pointer}
.cpz-slot.filled:hover{background:#e3f2fd;border-color:#2196f3;color:#2196f3}
.cpz-slot.cpz-drop-target{border-color:#2196f3;background:#e3f2fd}
.cpz-slot.cpz-slot-ok{border-color:#4caf50!important;background:#f0fff0!important;color:#2e7d32!important}
.cpz-slot.cpz-slot-err{border-color:#f44336!important;background:#fff0f0!important;color:#c62828!important}
.cpz-input{font-family:monospace;font-size:12px;padding:1px 5px;
           border:1.5px dashed #bbb;border-radius:3px;background:#fff;color:#222;
           min-width:90px;vertical-align:middle;outline:none;transition:border-color .1s}
.cpz-input:focus{border-color:#2196f3;border-style:solid}
.cpz-input.cpz-slot-ok{border-color:#4caf50!important;border-style:solid!important;background:#f0fff0}
.cpz-input.cpz-slot-err{border-color:#f44336!important;border-style:solid!important;background:#fff0f0}
.cpz-wb-wrap{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;padding:8px}
.cpz-wb-token{display:inline-block;padding:2px 7px;margin:2px;border:1px solid #ccc;
              border-radius:3px;background:#fff;font-family:monospace;font-size:12px;
              cursor:grab;user-select:none;white-space:nowrap}
.cpz-wb-token:active{cursor:grabbing}
.cpz-wb-token.cpz-used{opacity:.3;cursor:default}
.cpz-wb-token.cpz-drag-active{opacity:.4}
.cpz-actions{margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cpz-btn{padding:4px 14px;font-family:monospace;font-size:12px;border-radius:4px;
         cursor:pointer;border:1px solid #ccc;background:#fff;color:#333}
.cpz-btn.primary{background:#333;color:#fff;border-color:#333}
.cpz-btn.primary:hover{background:#111}
.cpz-result{font-size:12px}
.cpz-result.ok{color:#2e7d32}
.cpz-result.fail{color:#c62828}
.cpz-tip{font-size:11px;color:#aaa;margin-top:6px}
</style>]]
end

-- ── HTML scaffold ─────────────────────────────────────────────────────────────

local function make_html(id)
  return table.concat({
    '<div class="cpz" id="', id, '">',
      '<div class="cpz-layout">',
        '<div>',
          '<div class="cpz-col-label">Code &mdash; drag to reorder &middot; drop tokens onto blanks</div>',
          '<div style="display:flex">',
            '<div class="cpz-linenums" id="', id, '-linenums"></div>',
            '<div class="cpz-code" id="', id, '-code"></div>',
          '</div>',
        '</div>',
        '<div>',
          '<div class="cpz-col-label">Word Bank</div>',
          '<div class="cpz-wb-wrap"><div id="', id, '-wb"></div></div>',
          '<div class="cpz-tip">Drag onto a blank &middot; click a filled blank to clear &middot; drag blanks to swap</div>',
        '</div>',
      '</div>',
      '<div class="cpz-actions" id="', id, '-actions"></div>',
    '</div>',
  })
end

-- ── JavaScript ────────────────────────────────────────────────────────────────
-- Uses string concatenation throughout to avoid any ]] sequences
-- that could terminate a Lua long string.

local function make_js(id, blocks_json, wb_json, show_answers, show_hint)
  local parts = {}
  local function p(s) parts[#parts+1] = s end

  p('<script>\n(function(){\ntry{\n')
  p('var ID="') p(id) p('";\n')
  p('var BLOCKS=') p(blocks_json) p(';\n')
  p('var WB=')     p(wb_json)     p(';\n')
  p('var SHOW_ANSWERS=') p(show_answers and 'true' or 'false') p(';\n')
  p('var SHOW_HINT=')    p(show_hint    and 'true' or 'false') p(';\n')

  p([==[
var order,slotVals;
var feedbackShown=false,lastMsg='',lastMsgCls='';
var dragBi=null,dragWbWord=null,dragSlotRef=null;

// ── Tree helpers ──────────────────────────────────────────────────────────────
// order is a tree: [{bi, children:[...]}, ...]
// Only indent blocks ever have children. children=[] for all others.

function make_node(bi){ return {bi:bi,children:[]}; }

// Build initial tree from BLOCKS (original order, no children inside)
function build_tree(){
  var roots=[];
  // fixed blocks keep their original positions interleaved with draggables
  // We create a flat list of nodes for all blocks, then shuffle draggables
  var draggable_nodes=[];
  for(var i=0;i<BLOCKS.length;i++){
    var k=BLOCKS[i].kind;
    if(k==='drag'||k==='free'||k==='indent') draggable_nodes.push(make_node(i));
  }
  shuffle_arr(draggable_nodes);
  var di=0;
  for(var i=0;i<BLOCKS.length;i++){
    var k=BLOCKS[i].kind;
    if(k==='drag'||k==='free'||k==='indent') roots.push(draggable_nodes[di++]);
    else roots.push(make_node(i));
  }
  return roots;
}

// Find a node by bi anywhere in the tree. Returns {node, parent_children, index}.
function find_node(bi, children){
  children=children||order;
  for(var i=0;i<children.length;i++){
    if(children[i].bi===bi) return {node:children[i],list:children,idx:i};
    var found=find_node(bi,children[i].children);
    if(found) return found;
  }
  return null;
}

// Collect all bi values in a subtree (node + all descendants) as a flat array
function subtree_bis(node){
  var result=[node.bi];
  for(var i=0;i<node.children.length;i++){
    var sub=subtree_bis(node.children[i]);
    for(var j=0;j<sub.length;j++) result.push(sub[j]);
  }
  return result;
}

// Is bi_a an ancestor of bi_b in the tree?
function is_ancestor(bi_a, children){
  children=children||order;
  for(var i=0;i<children.length;i++){
    if(children[i].bi===bi_a) return true;
    if(is_ancestor(bi_a,children[i].children)) return true;
  }
  return false;
}

// Remove a node from wherever it is; return the node
function remove_node(bi){
  var f=find_node(bi);
  if(!f) return null;
  return f.list.splice(f.idx,1)[0];
}

// Insert node into list at position idx
function insert_node(node, list, idx){
  list.splice(idx,0,node);
}

// Move bi_moved to before/after bi_target at the same level as bi_target
function tree_move(bi_moved, bi_target, above){
  if(bi_moved===bi_target) return;
  var node=remove_node(bi_moved);
  if(!node) return;
  var f=find_node(bi_target);
  if(!f){insert_node(node,order,order.length);return;}
  // Can't drop into own subtree
  var subs=subtree_bis(node);
  if(subs.indexOf(bi_target)>=0){insert_node(node,order,order.length);return;}
  var idx=above?f.idx:f.idx+1;
  insert_node(node,f.list,idx);
}

// Drop bi_moved INTO an indent block (as its last child)
function tree_drop_into(bi_moved, bi_parent){
  if(bi_moved===bi_parent) return;
  var node=remove_node(bi_moved);
  if(!node) return;
  var f=find_node(bi_parent);
  if(!f){insert_node(node,order,order.length);return;}
  // Can't drop into own subtree
  var subs=subtree_bis(node);
  if(subs.indexOf(bi_parent)>=0){insert_node(node,order,order.length);return;}
  // Insert as last child of indent block (before the dropzone, so at end of children)
  f.node.children.push(node);
}

// ── Flatten tree for validation ───────────────────────────────────────────────
// Returns flat array of bi values in tree traversal order
function flatten_tree(children){
  children=children||order;
  var result=[];
  for(var i=0;i<children.length;i++){
    result.push(children[i].bi);
    var sub=flatten_tree(children[i].children);
    for(var j=0;j<sub.length;j++) result.push(sub[j]);
  }
  return result;
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init(){
  order=build_tree();
  slotVals={};
  for(var i=0;i<BLOCKS.length;i++) slotVals[i]={};
  feedbackShown=false;lastMsg='';lastMsgCls='';
  // Compute total row count once — this never changes regardless of drag order
  var total=0;
  for(var i=0;i<BLOCKS.length;i++){
    var b=BLOCKS[i];
    if(b.kind==='indent'){
      total++; // header
      total++; // drop zone (always present)
      if(b.footer) total++; // footer
    } else if(b.lines){
      total+=b.lines.length;
    }
  }
  var L=document.getElementById(ID+'-linenums');
  if(L){
    L.innerHTML='';
    for(var i=1;i<=total;i++){
      var d=document.createElement('div');d.textContent=i;L.appendChild(d);
    }
  }
  render();
}

function shuffle_arr(a){
  for(var i=a.length-1;i>0;i--){
    var j=Math.floor(Math.random()*(i+1));
    var t=a[i];a[i]=a[j];a[j]=t;
  }
}

// ── Slot helpers ──────────────────────────────────────────────────────────────
function gsv(bi,li,si){return((slotVals[bi]||{})[li]||{})[si]||null;}
function ssv(bi,li,si,v){
  if(!slotVals[bi])slotVals[bi]={};
  if(!slotVals[bi][li])slotVals[bi][li]={};
  slotVals[bi][li][si]=v;
}
function used_words(){
  var u={};
  for(var bi in slotVals)for(var li in slotVals[bi])for(var si in slotVals[bi][li]){
    var v=slotVals[bi][li][si];if(v)u[v]=(u[v]||0)+1;
  }
  return u;
}

function normalize(s){return s.replace(/\s+/g,'').trim();}

function get_line(bi,li){
  var b=BLOCKS[bi];if(!b)return null;
  if(b.kind==='indent')return li===0?b.header:(li===1?b.footer:null);
  return b.lines?b.lines[li]:null;
}

function slot_ok(bi,li,si,val){
  var line=get_line(bi,li);if(!line)return false;
  var slots=line.parts.filter(function(p){return p.type==='wb'||p.type==='free';});
  var slot=slots[si];if(!slot)return false;
  if(slot.type==='wb')return slot.answers.some(function(a){return a===(val||'');});
  if(slot.type==='free')return slot.answers.some(function(a){return normalize(val||'')===normalize(a||'');});
  return false;
}

function iter_slots(bi,cb){
  var b=BLOCKS[bi];if(!b)return;
  var entries=[];
  if(b.kind==='indent'){
    if(b.header)entries.push({line:b.header,li:0});
    if(b.footer)entries.push({line:b.footer,li:1});
  }else if(b.lines){
    for(var li=0;li<b.lines.length;li++)entries.push({line:b.lines[li],li:li});
  }
  entries.forEach(function(e){
    var si=0;
    e.line.parts.forEach(function(p){
      if(p.type==='wb'||p.type==='free'){cb(bi,e.li,si,p);si++;}
    });
  });
}

// ── Validation ────────────────────────────────────────────────────────────────
// Expected tree structure from BLOCKS definition
function expected_children(parent_uid){
  var result=[];
  for(var i=0;i<BLOCKS.length;i++){
    if(BLOCKS[i].parentId===parent_uid) result.push(i);
  }
  return result;
}

function check_tree_ok(nodes, expected_bis, maps){
  // Filter out fixed blocks from both sides
  var act=nodes.filter(function(n){return BLOCKS[n.bi].kind!=='fixed';});
  var exp=expected_bis.filter(function(bi){return BLOCKS[bi].kind!=='fixed';});
  if(act.length!==exp.length) return false;
  for(var i=0;i<exp.length;i++){
    var a=act[i].bi, e=exp[i];
    if(a!==e){
      var fg=BLOCKS[a].flexGroup;
      if(!(fg&&maps.flex[fg]&&maps.flex[fg][e])) return false;
    }
    // Check children of indent blocks
    if(BLOCKS[e].kind==='indent'){
      var exp_ch=expected_children(BLOCKS[e].id);
      if(!check_tree_ok(act[i].children, exp_ch, maps)) return false;
    } else {
      if(act[i].children.length>0) return false;
    }
  }
  return true;
}

function build_flex_map(){
  var flex={};
  for(var i=0;i<BLOCKS.length;i++){
    var fg=BLOCKS[i].flexGroup;
    if(fg){if(!flex[fg])flex[fg]={};flex[fg][i]=true;}
  }
  return {flex:flex};
}

function order_ok(){
  var maps=build_flex_map();
  var top_expected=[];
  for(var i=0;i<BLOCKS.length;i++){
    if(!BLOCKS[i].parentId) top_expected.push(i);
  }
  return check_tree_ok(order, top_expected, maps);
}

function blanks_ok(){
  for(var bi=0;bi<BLOCKS.length;bi++){
    var ok=true;
    iter_slots(bi,function(bi,li,si){if(!slot_ok(bi,li,si,gsv(bi,li,si)))ok=false;});
    if(!ok)return false;
  }
  return true;
}

function all_ok(){return order_ok()&&blanks_ok();}

function count_mistakes(){
  var n=0, maps=build_flex_map();
  function count_level(nodes, expected_bis){
    var act=nodes.filter(function(nd){return BLOCKS[nd.bi].kind!=='fixed';});
    var exp=expected_bis.filter(function(bi){return BLOCKS[bi].kind!=='fixed';});
    n+=Math.abs(act.length-exp.length);
    var len=Math.min(act.length,exp.length);
    for(var i=0;i<len;i++){
      var a=act[i].bi, e=exp[i];
      if(a!==e){
        var fg=BLOCKS[a].flexGroup;
        if(!(fg&&maps.flex[fg]&&maps.flex[fg][e])) n++;
      }
      if(BLOCKS[e].kind==='indent'){
        count_level(act[i].children, expected_children(BLOCKS[e].id));
      }
    }
  }
  var top_expected=[];
  for(var i=0;i<BLOCKS.length;i++){
    if(!BLOCKS[i].parentId) top_expected.push(i);
  }
  count_level(order, top_expected);
  // Blank mistakes
  for(var bi=0;bi<BLOCKS.length;bi++){
    iter_slots(bi,function(bi,li,si){if(!slot_ok(bi,li,si,gsv(bi,li,si)))n++;});
  }
  return n;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(){render_code();render_wb();render_actions();}

function render_code(){
  var C=document.getElementById(ID+'-code');C.innerHTML='';
  render_nodes(C, order, 0);
}

function render_nodes(C, nodes, depth){
  for(var i=0;i<nodes.length;i++){
    var node=nodes[i], bi=node.bi, block=BLOCKS[bi];
    if(block.kind==='indent') render_indent(C,node,depth);
    else if(block.kind==='free') render_free(C,bi,block,depth);
    else render_row(C,bi,block,depth,block.kind==='drag');
  }
}

function render_row(C,bi,block,depth,draggable){
  var row=document.createElement('div');row.className='cpz-row';
  var gut=document.createElement('div');
  gut.className='cpz-gutter'+(draggable?'':' no-drag');
  gut.textContent=draggable?'\u2837':'';
  row.appendChild(gut);
  var ld=document.createElement('div');
  ld.className='cpz-line'+(draggable?' cpz-draggable':'');
  if(block.lines){
    for(var li=0;li<block.lines.length;li++){
      build_content(ld,bi,li,block.lines[li]);
    }
  }
  if(draggable) setup_drag(ld,bi);
  row.appendChild(ld);C.appendChild(row);
}

function render_free(C,bi,block,depth){
  var wrap=document.createElement('div');wrap.className='cpz-free-block';
  for(var li=0;li<block.lines.length;li++){
    var row=document.createElement('div');row.className='cpz-free-row';
    if(li===0){
      var gut=document.createElement('span');gut.className='cpz-free-handle';
      gut.textContent='\u2837';row.appendChild(gut);
    } else {
      var spc=document.createElement('span');spc.className='cpz-free-handle';
      spc.textContent='';row.appendChild(spc);
    }
    var ld=document.createElement('div');ld.className='cpz-free-line';
    build_content(ld,bi,li,block.lines[li]);row.appendChild(ld);
    wrap.appendChild(row);
  }
  setup_drag(wrap,bi);C.appendChild(wrap);
}

function render_indent(C,node,depth){
  var bi=node.bi, block=BLOCKS[bi];
  var outer=document.createElement('div');outer.className='cpz-indent-wrap';
  var wrap=document.createElement('div');wrap.className='cpz-indent-block';
  // Header
  var hdr=document.createElement('div');hdr.className='cpz-indent-header';
  var gut=document.createElement('span');
  gut.style.cssText='color:#ccc;font-size:13px;margin-right:6px;user-select:none';
  gut.textContent='\u2837';hdr.appendChild(gut);
  build_content(hdr,bi,0,block.header);wrap.appendChild(hdr);
  // Children area
  var ch=document.createElement('div');ch.className='cpz-indent-children';
  render_nodes(ch, node.children, depth+1);
  // Drop zone
  var dz=document.createElement('div');
  dz.className='cpz-indent-dropzone';
  dz.textContent='drop here';
  dz.addEventListener('dragover',function(e){
    e.preventDefault();e.stopPropagation();
    if(dragBi!==null&&dragBi!==bi) dz.classList.add('cpz-drop-active');
  });
  dz.addEventListener('dragleave',function(){dz.classList.remove('cpz-drop-active');});
  dz.addEventListener('drop',function(e){
    e.preventDefault();e.stopPropagation();
    dz.classList.remove('cpz-drop-active');
    if(dragBi===null||dragBi===bi) return;
    tree_drop_into(dragBi,bi);
    dragBi=null;render();
  });
  ch.appendChild(dz);
  wrap.appendChild(ch);
  // Footer
  if(block.footer){
    var ftr=document.createElement('div');ftr.className='cpz-indent-footer';
    build_content(ftr,bi,1,block.footer);wrap.appendChild(ftr);
  }
  setup_drag(wrap,bi);outer.appendChild(wrap);C.appendChild(outer);
}

// ── Unified drag setup ────────────────────────────────────────────────────────
function setup_drag(el,bi){
  el.draggable=true;
  el.addEventListener('dragstart',function(e){
    if(dragBi!==null)return;
    if(dragWbWord!==null||dragSlotRef!==null){e.preventDefault();return;}
    dragBi=bi;
    e.dataTransfer.effectAllowed='move';
    e.stopPropagation();
    setTimeout(function(){el.classList.add('cpz-dragging');},0);
  });
  el.addEventListener('dragend',function(){el.classList.remove('cpz-dragging');dragBi=null;});
  el.addEventListener('dragover',function(e){
    e.preventDefault();e.stopPropagation();
    if(dragBi===null||dragBi===bi) return;
    var r=el.getBoundingClientRect();
    el.classList.remove('cpz-drag-over-above','cpz-drag-over-below');
    el.classList.add(e.clientY<r.top+r.height/2?'cpz-drag-over-above':'cpz-drag-over-below');
  });
  el.addEventListener('dragleave',function(e){
    el.classList.remove('cpz-drag-over-above','cpz-drag-over-below');
  });
  el.addEventListener('drop',function(e){
    e.preventDefault();e.stopPropagation();
    el.classList.remove('cpz-drag-over-above','cpz-drag-over-below');
    if(dragBi===null||dragBi===bi) return;
    var above=e.clientY<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2;
    tree_move(dragBi,bi,above);
    dragBi=null;render();
  });
}

function build_content(container,bi,li,line){
  if(!line) return;
  var si=0;
  line.parts.forEach(function(p){
    if(p.type==='text'){
      var s=document.createElement('span');s.textContent=p.value;container.appendChild(s);
    }else if(p.type==='wb'){container.appendChild(make_wb_slot(bi,li,si,p));si++;}
    else if(p.type==='free'){container.appendChild(make_free_input(bi,li,si,p));si++;}
  });
}

function make_wb_slot(bi,li,si,p){
  var val=gsv(bi,li,si);
  var slot=document.createElement('span');
  slot.className='cpz-slot'+(val?' filled':'');
  slot.textContent=val||'?';
  slot.dataset.bi=bi;slot.dataset.li=li;slot.dataset.si=si;
  slot.addEventListener('dragover',function(e){
    e.preventDefault();e.stopPropagation();
    if(dragWbWord!==null||dragSlotRef!==null)slot.classList.add('cpz-drop-target');
  });
  slot.addEventListener('dragleave',function(){slot.classList.remove('cpz-drop-target');});
  slot.addEventListener('drop',function(e){
    e.preventDefault();e.stopPropagation();
    slot.classList.remove('cpz-drop-target');
    if(dragWbWord!==null){ssv(bi,li,si,dragWbWord);dragWbWord=null;render();}
    else if(dragSlotRef!==null){
      var old=gsv(bi,li,si);
      ssv(bi,li,si,gsv(dragSlotRef.bi,dragSlotRef.li,dragSlotRef.si));
      ssv(dragSlotRef.bi,dragSlotRef.li,dragSlotRef.si,old);
      dragSlotRef=null;render();
    }
  });
  if(val){
    slot.draggable=true;
    slot.addEventListener('dragstart',function(e){
      dragSlotRef={bi:bi,li:li,si:si};dragWbWord=null;dragBi=null;
      e.dataTransfer.effectAllowed='move';e.stopPropagation();
    });
    slot.addEventListener('dragend',function(){dragSlotRef=null;});
    slot.addEventListener('click',function(){ssv(bi,li,si,null);render();});
  }
  return slot;
}

function make_free_input(bi,li,si,p){
  var inp=document.createElement('input');
  inp.type='text';inp.className='cpz-input';
  inp.value=gsv(bi,li,si)||'';inp.placeholder='...';
  inp.size=Math.max(8,(p.answers&&p.answers[0]||'').length+2);
  inp.dataset.bi=bi;inp.dataset.li=li;inp.dataset.si=si;
  inp.addEventListener('input',function(){ssv(bi,li,si,inp.value);});
  inp.addEventListener('mousedown',function(e){e.stopPropagation();});
  return inp;
}

// ── Word bank ─────────────────────────────────────────────────────────────────
function render_wb(){
  var wb=document.getElementById(ID+'-wb'),used=used_words();wb.innerHTML='';
  WB.forEach(function(word){
    var tok=document.createElement('span');
    tok.className='cpz-wb-token'+(used[word]?' cpz-used':'');
    tok.textContent=word;tok.draggable=!used[word];
    tok.addEventListener('dragstart',function(e){
      if(used[word]){e.preventDefault();return;}
      dragWbWord=word;dragBi=null;dragSlotRef=null;
      e.dataTransfer.effectAllowed='copy';
      setTimeout(function(){tok.classList.add('cpz-drag-active');},0);
    });
    tok.addEventListener('dragend',function(){tok.classList.remove('cpz-drag-active');dragWbWord=null;});
    wb.appendChild(tok);
  });
}

// ── Fill answers ──────────────────────────────────────────────────────────────
function fill_answers(){
  // Rebuild tree in correct order with children inside parents
  function build_correct_nodes(parent_uid){
    var result=[];
    for(var i=0;i<BLOCKS.length;i++){
      var b=BLOCKS[i];
      var pid=b.parentId||null;
      if(pid!==parent_uid) continue;
      var node=make_node(i);
      if(b.kind==='indent'&&b.id) node.children=build_correct_nodes(b.id);
      result.push(node);
    }
    return result;
  }
  // Top level: blocks with no parentId
  order=build_correct_nodes(null);
  // Fill all blanks
  for(var bi=0;bi<BLOCKS.length;bi++){
    iter_slots(bi,function(bi,li,si,p){
      ssv(bi,li,si,p.answers[0]);
    });
  }
}

// ── Build code text ───────────────────────────────────────────────────────────
function build_code_text(){
  var lines=[];
  function line_to_str(line,bi,li){
    if(!line) return '';
    var si=0;
    return line.parts.map(function(p){
      if(p.type==='text') return p.value;
      if(p.type==='wb'||p.type==='free'){var v=gsv(bi,li,si)||'';si++;return v;}
      return '';
    }).join('');
  }
  function indent_str(d){var s='';for(var i=0;i<d;i++)s+='    ';return s;}
  function walk(nodes, depth){
    for(var i=0;i<nodes.length;i++){
      var node=nodes[i],bi=node.bi,block=BLOCKS[bi];
      if(block.kind==='fixed'||block.kind==='drag'||block.kind==='free'){
        if(block.lines) for(var li=0;li<block.lines.length;li++)
          lines.push(indent_str(depth)+line_to_str(block.lines[li],bi,li));
      } else if(block.kind==='indent'){
        lines.push(indent_str(depth)+line_to_str(block.header,bi,0));
        walk(node.children, depth+1);
        if(block.footer) lines.push(indent_str(depth)+line_to_str(block.footer,bi,1));
      }
    }
  }
  walk(order,0);
  return lines.join('\n');
}

// ── Actions & feedback ────────────────────────────────────────────────────────
function render_actions(){
  var A=document.getElementById(ID+'-actions');A.innerHTML='';
  var btn=document.createElement('button');btn.className='cpz-btn primary';
  btn.textContent=feedbackShown?'Re-check':'Check answers';
  btn.addEventListener('click',function(){
    feedbackShown=true;
    if(all_ok()){lastMsg='\u2713 All correct!';lastMsgCls='cpz-result ok';}
    else{
      var n=count_mistakes();
      lastMsg='\u2717 '+n+' mistake'+(n!==1?'s':'')+' left';
      lastMsgCls='cpz-result fail';
    }
    render();apply_feedback();
  });
  A.appendChild(btn);
  if(SHOW_ANSWERS){
    var sa=document.createElement('button');sa.className='cpz-btn';
    sa.textContent='Show answers';
    sa.addEventListener('click',function(){
      fill_answers();
      feedbackShown=true;
      lastMsg='\u2713 All correct!';lastMsgCls='cpz-result ok';
      render();apply_feedback();
    });
    A.appendChild(sa);
  }
  if(feedbackShown){
    var msg=document.createElement('span');msg.className=lastMsgCls;msg.textContent=lastMsg;
    A.appendChild(msg);
    if(all_ok()){
      var cp=document.createElement('button');cp.className='cpz-btn';
      cp.textContent='Copy code';
      cp.addEventListener('click',function(){
        var code=build_code_text();
        navigator.clipboard.writeText(code).then(function(){
          cp.textContent='Copied!';
          setTimeout(function(){cp.textContent='Copy code';},1500);
        }).catch(function(){
          var ta=document.createElement('textarea');
          ta.value=code;ta.style.position='fixed';ta.style.opacity='0';
          document.body.appendChild(ta);ta.select();
          document.execCommand('copy');document.body.removeChild(ta);
          cp.textContent='Copied!';
          setTimeout(function(){cp.textContent='Copy code';},1500);
        });
      });
      A.appendChild(cp);
    }
    var rst=document.createElement('button');rst.className='cpz-btn';rst.textContent='Reset';
    rst.addEventListener('click',function(){init();});
    A.appendChild(rst);
  }
}

function apply_feedback(){
  var correct=all_ok();
  if(correct){
    document.querySelectorAll(
      '#'+ID+'-code .cpz-draggable,#'+ID+'-code .cpz-free-block,#'+ID+'-code .cpz-indent-block'
    ).forEach(function(el){el.classList.add('cpz-correct');});
    document.querySelectorAll('#'+ID+'-code .cpz-slot.filled').forEach(function(slot){
      slot.classList.add('cpz-slot-ok');
    });
    document.querySelectorAll('#'+ID+'-code .cpz-input').forEach(function(inp){
      inp.classList.add('cpz-slot-ok');
    });
  } else if(SHOW_HINT){
    document.querySelectorAll(
      '#'+ID+'-code .cpz-draggable,#'+ID+'-code .cpz-free-block,#'+ID+'-code .cpz-indent-block'
    ).forEach(function(el){el.classList.add('cpz-incorrect');});
    document.querySelectorAll('#'+ID+'-code .cpz-slot.filled').forEach(function(slot){
      var bi=+slot.dataset.bi,li=+slot.dataset.li,si=+slot.dataset.si;
      slot.classList.add(slot_ok(bi,li,si,gsv(bi,li,si))?'cpz-slot-ok':'cpz-slot-err');
    });
    document.querySelectorAll('#'+ID+'-code .cpz-input').forEach(function(inp){
      var bi=+inp.dataset.bi,li=+inp.dataset.li,si=+inp.dataset.si;
      inp.classList.add(slot_ok(bi,li,si,gsv(bi,li,si))?'cpz-slot-ok':'cpz-slot-err');
    });
  }
}

init();
}catch(err){
  var el=document.getElementById(ID+'-code');
  if(el){el.innerHTML='<div style="color:red;padding:8px;font-family:monospace;font-size:12px">'
    +'Puzzle error: '+err.message+'<br><pre>'+err.stack+'</pre></div>';}
  console.error('code-puzzle error in '+ID+':',err);
}
})();
</script>]==])

  return table.concat(parts)
end

-- ── AST-based block builder ───────────────────────────────────────────────────
-- Reads the Pandoc AST directly — no text reconstruction needed.
-- Pandoc has already parsed ::: static :::, ::: indent ::: etc. into Div nodes.

local function inlines_to_text(inlines)
  -- Flatten a list of Pandoc inlines to a plain string.
  -- Splits on LineBreak/SoftBreak and returns the first segment only
  -- (callers that need all lines use inlines_to_rawlines).
  local parts = {}
  for _, il in ipairs(inlines) do
    local t = il.t
    if     t == "Str"       then parts[#parts+1] = il.text
    elseif t == "Space"     then parts[#parts+1] = " "
    elseif t == "Code"      then parts[#parts+1] = il.text
    elseif t == "RawInline" then parts[#parts+1] = il.text
    elseif t == "LineBreak" or t == "SoftBreak" then
      parts[#parts+1] = "\n"
    elseif t == "Emph" or t == "Strong" or t == "Strikeout" or
           t == "Superscript" or t == "Subscript" then
      parts[#parts+1] = inlines_to_text(il.content)
    elseif t == "Quoted" then
      local q = il.quotetype == "DoubleQuote" and '"' or "'"
      parts[#parts+1] = q .. inlines_to_text(il.content) .. q
    elseif t == "Link" then
      parts[#parts+1] = inlines_to_text(il.content)
    end
  end
  return table.concat(parts)
end

local function para_to_rawlines(block)
  -- Convert a Para/Plain block to a list of raw line strings,
  -- splitting on embedded newlines (from LineBreak/SoftBreak inlines).
  local full = inlines_to_text(block.content)
  local lines = {}
  for seg in (full .. "\n"):gmatch("([^\n]*)\n") do
    if trim(seg) ~= "" then lines[#lines+1] = seg end
  end
  return lines
end

-- Forward declaration
local ast_parse_section

-- ast_parse_section: processes a list of Pandoc blocks into puzzle blocks.
-- flex_group, parent_id, depth: same semantics as text-based parser.
ast_parse_section = function(pandoc_blocks, wb_set, wb_list, flex_group, parent_id, depth)
  local blocks = {}
  depth = depth or 0

  local function add_wb(ans)
    if not wb_set[ans] then wb_set[ans]=true; wb_list[#wb_list+1]=ans end
  end

  local function parsed_line(raw)
    local parts = parse_slots(raw)
    for _, p in ipairs(parts) do
      if p.type == "wb" then for _, a in ipairs(p.answers) do add_wb(a) end end
    end
    return {indent=indent_level(raw), parts=parts}
  end

  local function make_block(kind, raw_lines)
    local b = {kind=kind, lines={}}
    for _, r in ipairs(raw_lines) do b.lines[#b.lines+1] = parsed_line(r) end
    return b
  end

  local function emit(b)
    if flex_group then b.flexGroup   = flex_group end
    if parent_id  then b.parentId    = parent_id  end
    b.indentDepth = depth
    blocks[#blocks+1] = b
  end

  local function has_class(div_block, cls)
    for _, c in ipairs(div_block.classes) do
      if c == cls then return true end
    end
    return false
  end

  for _, pblock in ipairs(pandoc_blocks) do
    local t = pblock.t

    if t == "Para" or t == "Plain" then
      -- Each line in the paragraph becomes a separate drag block
      local raw_lines = para_to_rawlines(pblock)
      for _, raw in ipairs(raw_lines) do
        emit(make_block("drag", {raw}))
      end

    elseif t == "CodeBlock" then
      -- Lines inside a bare code block become drag blocks
      for line in (pblock.text .. "\n"):gmatch("([^\n]*)\n") do
        if trim(line) ~= "" then emit(make_block("drag", {line})) end
      end

    elseif t == "Div" then
      if has_class(pblock, "static") then
        -- Every Para inside becomes a fixed block
        for _, child in ipairs(pblock.content) do
          if child.t == "Para" or child.t == "Plain" then
            local raw_lines = para_to_rawlines(child)
            for _, raw in ipairs(raw_lines) do
              if trim(raw) ~= "" then emit(make_block("fixed", {raw})) end
            end
          end
        end

      elseif has_class(pblock, "free") then
        -- All content becomes ONE multi-line draggable block
        local all_lines = {}
        for _, child in ipairs(pblock.content) do
          if child.t == "Para" or child.t == "Plain" then
            local raw_lines = para_to_rawlines(child)
            for _, raw in ipairs(raw_lines) do
              all_lines[#all_lines+1] = raw
            end
          elseif child.t == "CodeBlock" then
            for line in (child.text .. "\n"):gmatch("([^\n]*)\n") do
              all_lines[#all_lines+1] = line
            end
          end
        end
        -- strip leading/trailing blank lines
        while #all_lines > 0 and trim(all_lines[1])          == "" do table.remove(all_lines,1) end
        while #all_lines > 0 and trim(all_lines[#all_lines]) == "" do table.remove(all_lines)   end
        if #all_lines > 0 then emit(make_block("free", all_lines)) end

      elseif has_class(pblock, "flex") then
        -- Recurse with a shared flex group id
        local fid = uid()
        local child_blocks = ast_parse_section(
          pblock.content, wb_set, wb_list, fid, parent_id, depth)
        for _, cb in ipairs(child_blocks) do blocks[#blocks+1] = cb end

      elseif has_class(pblock, "indent") or has_class(pblock, "indent-include") then
        local start_outside = has_class(pblock, "indent") and not has_class(pblock, "indent-include")
        -- Collect all raw lines from Para children
        local all_lines = {}
        for _, child in ipairs(pblock.content) do
          if child.t == "Para" or child.t == "Plain" then
            local raw_lines = para_to_rawlines(child)
            for _, raw in ipairs(raw_lines) do
              if trim(raw) ~= "" then all_lines[#all_lines+1] = raw end
            end
          elseif child.t == "CodeBlock" then
            for line in (child.text .. "\n"):gmatch("([^\n]*)\n") do
              if trim(line) ~= "" then all_lines[#all_lines+1] = line end
            end
          end
        end

        if #all_lines >= 1 then
          local indent_id  = uid()
          local header_raw = trim(all_lines[1])
          local footer_raw = (#all_lines >= 2) and trim(all_lines[#all_lines]) or nil
          local inner      = {}
          local last       = (#all_lines >= 2) and (#all_lines - 1) or 1
          for j = 2, last do inner[#inner+1] = all_lines[j] end

          local ib = {
            kind         = "indent",
            id           = indent_id,
            indentDepth  = depth,
            startOutside = start_outside,
            header       = parsed_line(header_raw),
            footer       = (footer_raw and footer_raw ~= "")
                             and parsed_line(footer_raw) or nil,
          }
          if flex_group then ib.flexGroup = flex_group end
          if parent_id  then ib.parentId  = parent_id  end
          blocks[#blocks+1] = ib

          if #inner > 0 then
            local fake_blocks = {}
            for _, raw in ipairs(inner) do
              fake_blocks[#fake_blocks+1] = {
                t       = "Para",
                content = {{t="Str", text=raw}},
              }
            end
            local child_blocks = ast_parse_section(
              fake_blocks, wb_set, wb_list, nil, indent_id, depth + 1)
            for _, cb in ipairs(child_blocks) do blocks[#blocks+1] = cb end
          end
        end

      else
        -- Unknown div class: recurse and emit contents at same level
        local child_blocks = ast_parse_section(
          pblock.content, wb_set, wb_list, flex_group, parent_id, depth)
        for _, cb in ipairs(child_blocks) do blocks[#blocks+1] = cb end
      end
    end
    -- All other Pandoc block types (Header, HorizontalRule, etc.) ignored
  end

  return blocks
end

-- ── Pandoc filter entry point ─────────────────────────────────────────────────

function Div(div)
  if not div.classes:includes("code-puzzle") then return nil end

  local show_answers = div.classes:includes("answers")
  local show_hint    = div.classes:includes("hint")

  local wb_set, wb_list = {}, {}
  local blocks

  local source = nil
  for _, block in ipairs(div.content) do
    if block.t == "CodeBlock" then source = block.text; break end
  end

  if source then
    blocks, wb_list = parse_blocks(source)
  else
    blocks = ast_parse_section(div.content, wb_set, wb_list, nil, nil, 0)
  end

  if not blocks or #blocks == 0 then
    io.stderr:write("[code-puzzle] No content found inside ::::: code-puzzle :::::\n")
    return nil
  end

  local id          = uid()
  local blocks_json = json_encode(blocks)
  local wb_json     = json_encode(wb_list)

  local result = {}

  -- Inject CSS as a separate RawBlock only once
  if not css_injected then
    result[#result+1] = pandoc.RawBlock("html", make_css())
    css_injected = true
  end

  -- Puzzle div and script as a separate RawBlock
  result[#result+1] = pandoc.RawBlock("html",
    make_html(id) .. make_js(id, blocks_json, wb_json, show_answers, show_hint))

  return result
end