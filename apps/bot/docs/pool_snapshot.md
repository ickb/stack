# iCKB Deposit Pool Snapshot Encoding

## Introduction

Efficient asset conversion timing is paramount for the iCKB protocol, particularly when converting from iCKB to CKB. Although CKB-to-iCKB conversion timings are relatively simple to predict, the reverse process is influenced by factors like Bot CKB availability and, critically, the maturity of iCKB deposits available for withdrawal.

The protocol is currently evolving to route all conversions through the Bot and Limit Orders, with the objectives of:

- Optimizing deposit distribution over a 180-epoch cycle
- Minimizing direct interactions with the core protocol

This approach removes the need to fetch the entire deposit pool for core protocol interactions. However, evaluating iCKB-to-CKB conversion timings still requires accessing the pool, which introduces a significant challenge. For instance, if the iCKB TLV were to reach 10G CKB, a DApp might be forced to continuously retrieve around 100,000 deposit cells merely to estimate conversion timings. Such an approach is not only impractical, but it would also impose undue strain on Nervos L1 RPCs. Hence, there is an urgent need to accurately estimate conversion timings without incurring the overhead of querying an ever-growing number of deposit cells.

To address this, we propose a deposit pool snapshot mechanism. This solution offers a compact and efficient representation of deposit maturity events over the 180-epoch period. By capturing the maturity timings in a fixed snapshot and storing this information in the Bot CKB change cells, the system effectively eliminates the need for real-time data processing across extensive deposit cell datasets.

## Overview

The proposed solution encodes deposit maturity events on a 180-epoch cycle (~30 days) by partitioning the time interval into 1024 fixed bins, starting from an absolute origin that remains unchanged across snapshots. Each bin represents roughly 42 minutes. The number of bits allotted for each bin is determined dynamically on a per-snapshot basis, driven by the global maximum event count observed in any bin. This strategy is based on the following assumptions:

- Deposit maturity events are typically distributed evenly over time.
- Any clustering is smoothed by the pool rebalancing algorithm.
- The timing estimation can tolerate some resolution reduction.

## Key Components of the Encoding Approach

1. **Fixed Bin Count:**  
   The 180-epoch interval is divided into 1024 bins, ensuring a consistent duration per bin.

2. **Dynamic Bits-per-Bin Selection:**  
   The encoding process implicitly determines the bits allocated per bin by:
   - Assessing the total length of the serialized bit stream.
   - Computing the bits-per-bin value as (total_bits / 1024).

   For example:
   - If there is at most 1 event per bin, then 1 bit per bin suffices, so a minimum of 128 CKB is needed to store this information in the Bot CKB change cells.
   - If there is a maximum of 15 events in any bin, 4 bits per bin are required, totaling 512 CKB.
   - If there is a maximum of 255 events in any bin, 8 bits per bin are needed, adding up to 1024 CKB

3. **Implicit Parameter Communication:**  
   Both the encoder and decoder rely on a pre-agreed fixed structure of 1024 bins. The decoder can deduce the appropriate bits-per-bin value solely by inspecting the bot cell output data length, so there is no need for additional metadata specifying bin boundaries or bit allocations.

## Key Advantages

- **Simplicity:**  
  The fixed hierarchical structure permits straightforward and efficient packing and unpacking of the data.

- **Efficient Serialization:**  
  By dynamically allocating bits according to the maximum event count per bin, the serialized representation remains compact, while still accommodating peak loads.

- **Implicit Communication of Structure:**  
  Both the encoder and decoder derive necessary parameters from the known 1024-bin structure, obviating the need to transmit extra control information.

## Considerations and Mitigations

1. **Inflexibility of the Fixed Structure:**  
   - Concern: The 1024-bin configuration is fixed and does not scale dynamically.
   - Mitigation: Future protocol revisions can agree on increasing the bin count if finer granularity becomes necessary.

2. **Impact of Outliers on Bit Allocation:**  
   - Concern: A single bin with a high event count forces an increase in bits-per-bin across the entire snapshot.
   - Mitigation: The external smoothing provided by the rebalancing algorithm typically ameliorates the effect of such outliers.

3. **Limited Local Resolution:**  
   - Concern: Uniform resolution across fixed bins may overlook the precise timing of densely clustered events.
   - Mitigation: The trade-off is acceptable for the current use case, considering that the overall timing precision remains within operational requirements.

## Conclusion

The fixed-bin snapshot encoding method presents an elegant balance between simplicity, efficiency and resolution. By mapping deposit maturity events over a 180-epoch period into a fixed 1024-bin structure, the mechanism minimizes real-time data processing while ensuring sufficient timing resolution for reliable conversion estimations. Although the design involves certain trade-offs, it effectively meets the current operational requirements by reducing RPC load and enhancing system agility.

Looking ahead, further refinements to the encoding model could be explored to adapt the granularity based on evolving event patterns. For now, this robust mechanism underpins the rapid, dependable performance of the Fulfillment bot in a dynamic liquidity environment.
