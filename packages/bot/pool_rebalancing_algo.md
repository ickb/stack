# iCKB Deposit Pool Rebalancing Algorithm

For simplicity, let's model:

- NervosDAO 180 epoch cycle as a circular clock.
- Current Tip Header Epoch as the the clock needle.
- iCKB Deposits as coins scattered continuously along the clock perimeter.
- iCKB Deposit Pool size as the total coins.
- Making an iCKB Deposit into the Pool as depositing a coin.
- Withdrawing an iCKB Deposit from the Pool as picking up a coin.

## Environment

- **Setting Idea:** A circular clock with coins scattered continuously along the perimeter. The environment deterministically over time sets the direction in which the agent is looking at, the one pointed by the needle.
- **Dynamics:** Our agent can only interact with coins pointed by the needle. External parties can add or remove coins arbitrarily, so the total coins `N` may change over time.

## Agent Details

- **Position:** Center of the circle, facing a specific segment of the perimeter.
- **Action:** Operates in discrete snapshots, snapshots occur at regular intervals.
- **Container:** Holds `m` coins up to a capacity `M`.
- **Memory:** None (each snapshot is processed independently).

## Overall Objectives

- **Uniformity:** Aim for a reasonably uniform coin distribution across the perimeter.

- **Minimize Re-shuffling:** Minimize coin re-shuffling when external parties add or remove coins by using a robust representation.

- **Maximize Holdings:** Maximize the coins held by the agent (up to `M`).

## Perimeter Segmentation

- **Free Coins:** `O = N + m - M`, which accounts for the total coins available minus the agent's capacity. This way `O` is independent from the coins held by agent.

- **Segmentation Function:** Total segments = `2^(ceil(log2(O)))`. Each segment have the same length and it can be indexed (0,1,2...) starting from an absolute origin that remains unchanged across snapshots. Segmentation is recalculated at every snapshot, so coins placed previously may change immediately the segment they belong to. Segment evaluation cycles modulo `O`: 0, 1, 2, … `O` - 1  and then repeats.

- **Segment Priority:**
  - **High-Priority Segments:** Odd-numbered segments (indices 1,3...) are High-Priority and at equilibrium each must have exactly one coin.
  - **Low-Priority Segments:** Even-numbered segments (indices 0,2...) are Low-Priority and at equilibrium each must have either one or zero coins.
  - **Visual Idea:** We can visualize this segmentation prioritization as the alternating colors of the outer rim of a circular Dart Board.

## Strategy and Dynamics

Given a snapshot, segmentation recalculation always occurs prior to action decisions. Agent actions are greedy (taken as soon as available) to minimize disruptions from other agents, which modify the system state outside of our agent control.

### General Pick-up Rules

- Never pick up the last coin of an High-Priority Segment.
- Pick up coins from each segment sequentially, starting with the coin nearest the segment’s beginning and proceeding toward its end. Within any stack of coins at the same position, pick them from the top down. Leave the last segment coin in place if applicable.

### General Deposit Rules

- When depositing a coin, deposit it as close as possible to the end of the chosen segment, while still staying in the right segment by a reasonably small margin. This margin size is snapshot-based, extremely small relative to segment size. This ensures that if resolution increases and the interval is subdivided, the coin remains in the high-priority portion.

### Initial State: Non-Equilibrium

**State:**

- At least one High-Priority Segment has zero coins.
- Some segments have multiple coins.

**Pick-up Strategy:** Follow general rules for multiple coins in one segment. If no segments with multiple coins exist, pick up coins from Low-Priority Segments.

**Deposit Strategy:** Deposit a coin when an High-Priority Segment is empty and the agent has coins.

### Intermediate Target: Near Equilibrium

**State:**

- All High-Priority Segments have at least one coin.
- Some segments have multiple coins.

**Pick-up Strategy:** Follow general rules for multiple coins in one segment.

**Deposit Strategy:** Deposit a coin when a Low-Priority Segment is empty and the agent has coins.

### Final Target: Equilibrium

**State:**

- All High-Priority Segments have exactly one coin.
- All Low-Priority Segments have exactly one or zero coins.

**Pick-up Strategy:** Pick up coins from Low-Priority Segments until the agent has `M` coins.

**Deposit Strategy:** None.

### Dynamics

- If Segmentation resolution increases (due to increased `O`), deposited coins in previous snapshots (placed at the end of segments) automatically fall into the High-Priority portions of their new subdivided segments.
- If Segmentation resolution decreases (due to decreased `O`), previous high and low priority segments naturally merge into the lower resolution segments.
- The system adapts at each snapshot to reach uniformity and priority requirements, gaining stability. Oscillatory behaviors (frequent pick-ups and deposits) are prevented as much as possible by a smart segmentation.
