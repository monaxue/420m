
library(tidyverse)

data <- read_csv("data/shapeVsHours.csv")

straight_line <- lm(reported_shape ~ hours, data = data)

straight_line

data <- data %>% mutate(pred = (straight_line$coefficients[1] + hours * straight_line$coefficients[2]), resids = straight_line$residuals)

ggplot(data=data, aes(x=hours, y=reported_shape)) + 
    geom_point(color="firebrick") + 
    geom_line(aes(x=hours, y=pred), color="steelblue", linewidth=1.5) + 
    geom_segment(aes(x=hours, y=0, xend=hours, yend=pred), color="steelblue") + 
    geom_segment(aes(x=hours, y=0, xend=hours, yend=reported_shape), color="firebrick") + 
    ylim(min(data$resids), max(data$reported_shape)) + 
    geom_point(aes(x=hours, y=resids), color="firebrick") + 
    geom_segment(aes(x = min(hours), xend = max(hours), y = 0, yend=0), color="steelblue", linewidth=1) + 
    ylim(min(data$resids), max(data$reported_shape))


# install.packages("gganimate")  # if needed
library(tidyverse)
library(gganimate)

data_anim <- data %>%
  mutate(id = row_number()) %>%                      # so gganimate can track each point
  tidyr::crossing(state = c("Regression plot", "Residual plot")) %>%
  mutate(
    # Where the **points** should be in each state
    y_point = ifelse(state == "Regression plot", reported_shape, resids),

    # Where the **blue line** (model) should be in each state
    y_line  = ifelse(state == "Regression plot", pred, 0),

    # Where the **firebrick verticals** should end in each state
    y_seg_data = ifelse(state == "Regression plot", reported_shape, resids),

    # Where the **blue verticals** (to model) should end in each state
    y_seg_pred = ifelse(state == "Regression plot", pred, 0)
  )

y_min <- min(data$resids)
y_max <- max(data$reported_shape)

p <- ggplot(data_anim, aes(x = hours)) +
  # Points: actual y (or residuals) depending on state
  geom_point(
    aes(y = y_point, group = id),
    color = "firebrick"
  ) +
  # Blue regression / zero line
  geom_line(
    aes(y = y_line, group = state),
    color = "steelblue",
    linewidth = 1
  ) +
  
  # Firebrick verticals: from 0 to actual (or residuals)
  geom_segment(
    aes(
      xend = hours-0.01,
      y    = 0,
      yend = y_seg_data,
      group = id
    ),
    color = "firebrick",
    alpha = 0.2,
    linewidth=1
  ) +

    # Blue verticals: from 0 to fitted (or 0)
  geom_segment(
    aes(
      xend = hours+0.01,
      y    = 0,
      yend = y_seg_pred,
      group = id
    ),
    color = "steelblue",
    alpha = 0.2,
    linewidth=1
  ) +
  # Horizontal 0 line (helps in residual state)
  geom_hline(yintercept = 0, color = "steelblue", linewidth = 1, linetype = "dashed") +
  coord_cartesian(ylim = c(y_min, y_max)) +
  labs(
    title = "{closest_state}",
    x = "hours",
    y = "reported shape / residuals"
  ) +
  theme_minimal(base_size = 14) +
  transition_states(
    state,
    transition_length = 2,
    state_length = 1
  ) +
  ease_aes("cubic-in-out")

anim <- animate(p, nframes = 80, fps = 20, width = 600, height = 450)
#anim

# To save:
anim_save("presentations/assets/regression_to_residuals.gif", animation = anim)