//! Commit graph lane layout.
//!
//! Every commit row gets a node column and two sets of line segments: the
//! upper half (from the top edge of the row to the node line) and the lower
//! half (from the node line to the bottom edge). A segment is
//! `[from_col, to_col, color]`. Lanes keep their column, so colouring by lane
//! keeps every branch line one colour across rows.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct GraphRow {
    pub col: usize,
    pub color: usize,
    pub top: Vec<[usize; 3]>,
    pub bottom: Vec<[usize; 3]>,
    pub width: usize,
}

struct Lane {
    hash: String,
    color: usize,
}

pub fn layout(commits: &[(String, Vec<String>)]) -> Vec<GraphRow> {
    let mut lanes: Vec<Option<Lane>> = Vec::new();
    let mut next_color = 0usize;
    let mut rows = Vec::with_capacity(commits.len());

    let alloc = |lanes: &mut Vec<Option<Lane>>, hash: String, color: usize| -> usize {
        if let Some(i) = lanes.iter().position(|l| l.is_none()) {
            lanes[i] = Some(Lane { hash, color });
            i
        } else {
            lanes.push(Some(Lane { hash, color }));
            lanes.len() - 1
        }
    };

    for (hash, parents) in commits {
        let mut row = GraphRow::default();

        // Column of this commit: the first lane waiting for it, or a new lane.
        let col = match lanes.iter().position(|l| l.as_ref().map(|l| &l.hash == hash).unwrap_or(false)) {
            Some(c) => c,
            None => {
                let c = next_color;
                next_color += 1;
                alloc(&mut lanes, hash.clone(), c)
            }
        };
        let node_color = lanes[col].as_ref().unwrap().color;
        row.col = col;
        row.color = node_color;

        // Upper half: lanes pass straight through, lanes waiting for this
        // commit converge into the node.
        for (c, lane) in lanes.iter().enumerate() {
            if let Some(l) = lane {
                if &l.hash == hash {
                    row.top.push([c, col, l.color]);
                } else {
                    row.top.push([c, c, l.color]);
                }
            }
        }
        for c in 0..lanes.len() {
            if c != col && lanes[c].as_ref().map(|l| &l.hash == hash).unwrap_or(false) {
                lanes[c] = None;
            }
        }

        // Lower half.
        let find = |lanes: &Vec<Option<Lane>>, h: &str| {
            lanes.iter().position(|l| l.as_ref().map(|l| l.hash == h).unwrap_or(false))
        };
        let mut handled: Vec<usize> = vec![col];
        if let Some(first) = parents.first() {
            match find(&lanes, first) {
                Some(p) if p < col => {
                    // join the lane on the left that already waits for the parent
                    let color = lanes[p].as_ref().unwrap().color;
                    row.bottom.push([col, p, color]);
                    lanes[col] = None;
                }
                Some(p) => {
                    // pull the lane on the right into this column
                    let color = lanes[p].as_ref().unwrap().color;
                    lanes[p] = None;
                    lanes[col] = Some(Lane { hash: first.clone(), color: node_color });
                    row.bottom.push([p, col, color]);
                    row.bottom.push([col, col, node_color]);
                    handled.push(p);
                }
                None => {
                    lanes[col] = Some(Lane { hash: first.clone(), color: node_color });
                    row.bottom.push([col, col, node_color]);
                }
            }
            for parent in parents.iter().skip(1) {
                match find(&lanes, parent) {
                    Some(p) => {
                        let color = lanes[p].as_ref().unwrap().color;
                        row.bottom.push([col, p, color]);
                    }
                    None => {
                        let color = next_color;
                        next_color += 1;
                        let n = alloc(&mut lanes, parent.clone(), color);
                        row.bottom.push([col, n, color]);
                        handled.push(n);
                    }
                }
            }
        } else {
            lanes[col] = None;
        }
        for (c, lane) in lanes.iter().enumerate() {
            if let Some(l) = lane {
                if !handled.contains(&c) {
                    row.bottom.push([c, c, l.color]);
                }
            }
        }

        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }
        let max_top = row.top.iter().map(|s| s[0].max(s[1])).max().unwrap_or(0);
        let max_bot = row.bottom.iter().map(|s| s[0].max(s[1])).max().unwrap_or(0);
        row.width = max_top.max(max_bot).max(col) + 1;
        rows.push(row);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(h: &str, p: &[&str]) -> (String, Vec<String>) {
        (h.to_string(), p.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn linear_history_is_one_lane() {
        let rows = layout(&[c("c", &["b"]), c("b", &["a"]), c("a", &[])]);
        assert!(rows.iter().all(|r| r.col == 0));
        assert!(rows[2].bottom.is_empty());
    }

    #[test]
    fn merge_opens_and_closes_lane() {
        // m merges x (side) into b
        let rows = layout(&[c("m", &["b", "x"]), c("x", &["a"]), c("b", &["a"]), c("a", &[])]);
        assert_eq!(rows[0].col, 0);
        assert_eq!(rows[1].col, 1);
        assert_eq!(rows[2].col, 0);
        assert_eq!(rows[3].col, 0);
        // the side lane is pulled back into lane 0 below "b"
        assert!(rows[2].bottom.iter().any(|s| s[0] == 1 && s[1] == 0));
        assert_eq!(rows[3].width, 1);
    }
}
