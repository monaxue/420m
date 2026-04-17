-- column-card.lua
--
-- Wraps all content inside .column divs with a .column-card inner div.
-- Fragment is DEFAULT - use .nonincremental to disable column-card only.
-- Options:
--   ::: column {width="33%"}      -> appears incrementally (default)
--   ::: column {width="33%" .nonincremental} -> column appears immediately, items inside keep own fragments
-- Usage in Quardo markdown:
--   ::: column {width="33%"}
--   Your content here (headers, lists, text, code, etc.)
--   :::

function Pandoc(doc)
  local function wrap_columns(block)
    if block.t == "Div" and block.classes[1] == "column" then
      -- Check if column has .nonincremental class
      local has_nonincremental = false
      local new_classes = {}
      for _, class in ipairs(block.classes) do
        if class == "nonincremental" then
          has_nonincremental = true
        else
          table.insert(new_classes, class)
        end
      end
      block.classes = new_classes
      
      -- Create a new div with class column-card
      local inner_div = pandoc.Div(block.content, {class = "column-card"})
      
      -- Add fragment class to column-card by default (unless nonincremental)
      if not has_nonincremental then
        table.insert(inner_div.classes, "fragment")
      end
      
      -- Replace block content with the wrapped version
      block.content = {inner_div}
    elseif block.t == "Div" then
      -- Recurse into nested divs
      for i, inner in ipairs(block.content) do
        block.content[i] = wrap_columns(inner)
      end
    elseif block.t == "BlockQuote" then
      for i, inner in ipairs(block.content) do
        block.content[i] = wrap_columns(inner)
      end
    end
    return block
  end
  
  -- Process all top-level blocks
  for i, block in ipairs(doc.blocks) do
    doc.blocks[i] = wrap_columns(block)
  end
  
  return doc
end