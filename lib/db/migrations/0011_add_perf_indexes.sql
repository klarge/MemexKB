-- Performance indexes for scale: articles, tasks, projects, boards, cards
-- These cover the WHERE / ORDER BY / JOIN columns used by every major list query.

-- Articles: list ordering and log-entry scoped lookups
CREATE INDEX IF NOT EXISTS idx_articles_updated_at       ON articles (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_created_by_id    ON articles (created_by_id);
-- Composite index for the paginated log endpoint (WHERE is_log_entry AND created_by_id ORDER BY created_at DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_articles_log_paged        ON articles (is_log_entry, created_by_id, created_at DESC, id DESC);

-- Article join tables: group-access filtering and article-side lookups
CREATE INDEX IF NOT EXISTS idx_article_groups_article_id ON article_groups (article_id);
CREATE INDEX IF NOT EXISTS idx_article_groups_group_id   ON article_groups (group_id);

-- Article versions: per-article history queries
CREATE INDEX IF NOT EXISTS idx_article_versions_article_id ON article_versions (article_id);

-- Tasks: ownership chain (user → list → task)
CREATE INDEX IF NOT EXISTS idx_task_lists_user_id        ON task_lists (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_list_id             ON tasks (list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at        ON tasks (completed_at);

-- Projects: owner-filtered ordered listing (non-admin path) and admin ordered listing
CREATE INDEX IF NOT EXISTS idx_projects_created_by_order ON projects (created_by_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at_id    ON projects (updated_at DESC, id);

-- Project groups: group_id is the filter column in the non-admin access check;
-- (group_id, project_id) covers both the WHERE and the SELECT in one index scan.
CREATE INDEX IF NOT EXISTS idx_project_groups_group_id   ON project_groups (group_id, project_id);

-- Boards / columns / cards: hierarchy traversal and position ordering
CREATE INDEX IF NOT EXISTS idx_boards_project_id         ON boards (project_id);
CREATE INDEX IF NOT EXISTS idx_board_columns_board_id    ON board_columns (board_id);
CREATE INDEX IF NOT EXISTS idx_board_cards_column_id     ON board_cards (column_id);
CREATE INDEX IF NOT EXISTS idx_board_cards_col_position  ON board_cards (column_id, position);
CREATE INDEX IF NOT EXISTS idx_board_cards_due_date      ON board_cards (due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_groups_project_id ON project_groups (project_id);
