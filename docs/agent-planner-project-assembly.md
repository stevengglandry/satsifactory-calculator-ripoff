# Agent Planner Project Assembly Reference

This document is the planner source of truth for Project Assembly targets in game version 1.2.

## Planning Concepts

- Direct Delivery: the quantity of a Project Part that must be physically submitted to the Space Elevator for a Phase.
- Absolute Cumulative Total: the global production quota for a Project Part, including units delivered to the Space Elevator and units consumed as sub-components in later Project Assembly recipes.
- Total Project Assembly production quota: exactly 29,002 Project Assembly parts.

## Unified Space Elevator Requirement Table

| Project Part | Class Name | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Absolute Cumulative Total |
|---|---|---:|---:|---:|---:|---:|---:|
| Smart Plating | Desc_SpaceElevatorPart_1_C | 50 | 1,000 | 0 | 0 | 0 | 5,550 |
| Automated Wiring | Desc_SpaceElevatorPart_3_C | 0 | 100 | 0 | 0 | 0 | 6,490 |
| Versatile Framework | Desc_SpaceElevatorPart_2_C | 0 | 1,000 | 2,500 | 0 | 0 | 8,500 |
| Adaptive Control Unit | Desc_SpaceElevatorPart_5_C | 0 | 0 | 100 | 0 | 0 | 1,600 |
| Modular Engine | Desc_SpaceElevatorPart_4_C | 0 | 0 | 500 | 0 | 0 | 2,250 |
| Assembly Director System | Desc_SpaceElevatorPart_7_C | 0 | 0 | 0 | 500 | 0 | 750 |
| Magnetic Field Generator | Desc_SpaceElevatorPart_6_C | 0 | 0 | 0 | 500 | 0 | 756 |
| Nuclear Pasta | Desc_SpaceElevatorPart_9_C | 0 | 0 | 0 | 100 | 1,000 | 1,200 |
| Thermal Propulsion Rocket | Desc_SpaceElevatorPart_8_C | 0 | 0 | 0 | 250 | 0 | 450 |
| Biochemical Sculptor | Desc_SpaceElevatorPart_10_C | 0 | 0 | 0 | 0 | 1,000 | 1,000 |
| AI Expansion Server | Desc_SpaceElevatorPart_12_C | 0 | 0 | 0 | 0 | 256 | 256 |
| Ballistic Warp Drive | Desc_SpaceElevatorPart_11_C | 0 | 0 | 0 | 0 | 200 | 200 |

## Recommendation Rules

- Plan A targets the next direct Space Elevator delivery part needed for phase progression.
- Plan B targets the largest remaining absolute cumulative quota deficit that is different from Plan A.
- Plan C targets the next useful downstream or catch-up Project Assembly part that differs from Plan A and Plan B.
- Recommendation rates should be practical small or medium factories: cap selected nodes to roughly one to three nodes per required raw resource and never exceed the solver-feasible rate for the selected cluster.
- Route information is a ranking bonus only. Train stations, tracks, truck stops, and paths should improve cluster scores when nearby, but full train or truck pathfinding is out of scope.
- If exact delivery progress cannot be read from a save, infer progress from inventory and production state and show a confidence warning.
