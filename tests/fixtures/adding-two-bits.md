---
tags:
  - digital-logic
  - electronics
topic: Combinational circuits
---

# Adding two bits

A half adder is the smallest useful arithmetic circuit: it adds two one-bit inputs, **A** and **B**, and produces a sum bit **S** and a carry bit **C**.

The carry belongs in the next binary column. This is why adding two 1s produces `10`, rather than a single output bit.

> [!summary] Two outputs, two different questions
> **Sum:** are the inputs different?  
> **Carry:** are both inputs 1?

## The direct implementation

An XOR gate answers the first question, and an AND gate answers the second. Both gates receive the same pair of inputs.
```logic-circuit
{
  "schemaVersion": 1,
  "circuitId": "6c415c4f-7c94-4085-929a-a5ff777137bb",
  "nodes": [
    {
      "id": "a",
      "type": "input",
      "position": {
        "x": 16,
        "y": 8
      },
      "label": "A"
    },
    {
      "id": "b",
      "type": "input",
      "position": {
        "x": 16,
        "y": 40
      },
      "label": "B"
    },
    {
      "id": "ja",
      "type": "junction",
      "position": {
        "x": 128,
        "y": 32
      }
    },
    {
      "id": "jb",
      "type": "junction",
      "position": {
        "x": 176,
        "y": 64
      }
    },
    {
      "id": "sum",
      "type": "xor",
      "position": {
        "x": 280,
        "y": 24
      }
    },
    {
      "id": "carry",
      "type": "and",
      "position": {
        "x": 272,
        "y": 120
      }
    },
    {
      "id": "s",
      "type": "output",
      "position": {
        "x": 416,
        "y": 24
      },
      "label": "S"
    },
    {
      "id": "c",
      "type": "output",
      "position": {
        "x": 416,
        "y": 120
      },
      "label": "C"
    }
  ],
  "edges": [
    {
      "id": "a-ja",
      "sourceNodeId": "a",
      "sourcePinId": "out",
      "targetNodeId": "ja",
      "targetPinId": "in-1"
    },
    {
      "id": "b-jb",
      "sourceNodeId": "b",
      "sourcePinId": "out",
      "targetNodeId": "jb",
      "targetPinId": "in-1"
    },
    {
      "id": "ja-sum",
      "sourceNodeId": "ja",
      "sourcePinId": "out",
      "targetNodeId": "sum",
      "targetPinId": "in-1"
    },
    {
      "id": "jb-sum",
      "sourceNodeId": "jb",
      "sourcePinId": "out",
      "targetNodeId": "sum",
      "targetPinId": "in-2"
    },
    {
      "id": "ja-carry",
      "sourceNodeId": "ja",
      "sourcePinId": "out",
      "targetNodeId": "carry",
      "targetPinId": "in-1"
    },
    {
      "id": "jb-carry",
      "sourceNodeId": "jb",
      "sourcePinId": "out",
      "targetNodeId": "carry",
      "targetPinId": "in-2"
    },
    {
      "id": "sum-s",
      "sourceNodeId": "sum",
      "sourcePinId": "out",
      "targetNodeId": "s",
      "targetPinId": "in-1"
    },
    {
      "id": "carry-c",
      "sourceNodeId": "carry",
      "sourcePinId": "out",
      "targetNodeId": "c",
      "targetPinId": "in-1"
    }
  ],
  "view": {
    "preferredScale": 1.15
  }
}
```
$$
S = A \oplus B \qquad C = A \land B
$$

Quick check: with **A = 1** and **B = 1**, the XOR gives **S = 0** and the AND gives **C = 1**. Reading the result as **CS** gives `10₂`, which is 2.

The filled dots show where an input branches. Where two wires merely cross, they are still separate signals.

## Building the same circuit with NAND gates

The sum can also be built from four NAND gates. The first NAND produces the complement of the carry, and a NOT gate turns it back into **C**.

```logic-circuit
{
  "schemaVersion": 1,
  "circuitId": "9e520928-6bf2-4555-b173-02f365b609b4",
  "nodes": [
    {
      "id": "a",
      "type": "input",
      "position": {
        "x": 16,
        "y": 8
      },
      "label": "A"
    },
    {
      "id": "b",
      "type": "input",
      "position": {
        "x": 16,
        "y": 136
      },
      "label": "B"
    },
    {
      "id": "ja",
      "type": "junction",
      "position": {
        "x": 120,
        "y": 32
      }
    },
    {
      "id": "jb",
      "type": "junction",
      "position": {
        "x": 120,
        "y": 160
      }
    },
    {
      "id": "n1",
      "type": "nand",
      "position": {
        "x": 208,
        "y": 72
      }
    },
    {
      "id": "jn",
      "type": "junction",
      "position": {
        "x": 328,
        "y": 96
      }
    },
    {
      "id": "n2",
      "type": "nand",
      "position": {
        "x": 400,
        "y": 24
      }
    },
    {
      "id": "n3",
      "type": "nand",
      "position": {
        "x": 400,
        "y": 152
      }
    },
    {
      "id": "n4",
      "type": "nand",
      "position": {
        "x": 552,
        "y": 88
      }
    },
    {
      "id": "carry",
      "type": "not",
      "position": {
        "x": 400,
        "y": 264
      }
    },
    {
      "id": "s",
      "type": "output",
      "position": {
        "x": 704,
        "y": 88
      },
      "label": "S"
    },
    {
      "id": "c",
      "type": "output",
      "position": {
        "x": 552,
        "y": 264
      },
      "label": "C"
    }
  ],
  "edges": [
    {
      "id": "a-ja",
      "sourceNodeId": "a",
      "sourcePinId": "out",
      "targetNodeId": "ja",
      "targetPinId": "in-1"
    },
    {
      "id": "b-jb",
      "sourceNodeId": "b",
      "sourcePinId": "out",
      "targetNodeId": "jb",
      "targetPinId": "in-1"
    },
    {
      "id": "ja-n1",
      "sourceNodeId": "ja",
      "sourcePinId": "out",
      "targetNodeId": "n1",
      "targetPinId": "in-1"
    },
    {
      "id": "jb-n1",
      "sourceNodeId": "jb",
      "sourcePinId": "out",
      "targetNodeId": "n1",
      "targetPinId": "in-2"
    },
    {
      "id": "n1-jn",
      "sourceNodeId": "n1",
      "sourcePinId": "out",
      "targetNodeId": "jn",
      "targetPinId": "in-1"
    },
    {
      "id": "ja-n2",
      "sourceNodeId": "ja",
      "sourcePinId": "out",
      "targetNodeId": "n2",
      "targetPinId": "in-1"
    },
    {
      "id": "jn-n2",
      "sourceNodeId": "jn",
      "sourcePinId": "out",
      "targetNodeId": "n2",
      "targetPinId": "in-2"
    },
    {
      "id": "jb-n3",
      "sourceNodeId": "jb",
      "sourcePinId": "out",
      "targetNodeId": "n3",
      "targetPinId": "in-1"
    },
    {
      "id": "jn-n3",
      "sourceNodeId": "jn",
      "sourcePinId": "out",
      "targetNodeId": "n3",
      "targetPinId": "in-2"
    },
    {
      "id": "n2-n4",
      "sourceNodeId": "n2",
      "sourcePinId": "out",
      "targetNodeId": "n4",
      "targetPinId": "in-1"
    },
    {
      "id": "n3-n4",
      "sourceNodeId": "n3",
      "sourcePinId": "out",
      "targetNodeId": "n4",
      "targetPinId": "in-2"
    },
    {
      "id": "n4-s",
      "sourceNodeId": "n4",
      "sourcePinId": "out",
      "targetNodeId": "s",
      "targetPinId": "in-1"
    },
    {
      "id": "jn-carry",
      "sourceNodeId": "jn",
      "sourcePinId": "out",
      "targetNodeId": "carry",
      "targetPinId": "in-1"
    },
    {
      "id": "carry-c",
      "sourceNodeId": "carry",
      "sourcePinId": "out",
      "targetNodeId": "c",
      "targetPinId": "in-1"
    }
  ],
  "view": {
    "preferredScale": 1
  }
}
```

Let the first NAND's result be **N**:

$$
\begin{aligned}
N &= \neg(A \land B) \\
S &= \neg\bigl(\neg(A \land N) \land \neg(B \land N)\bigr) \\
C &= \neg N
\end{aligned}
$$

Same behavior, different construction. The direct version is easier to read; the NAND version shows how a small set of gates can express the same logic.

## What this circuit is missing

A half adder has no incoming carry. To add another binary column, I need a **full adder** with a third input, **Cᵢₙ**.

- [x] Separate the sum bit from the carry bit.
- [x] Draw both implementations and mark the branches explicitly.
- [ ] Extend the direct circuit with an incoming carry.
- [ ] Compare the extra gates needed for a full adder.

Related: [[Boolean algebra]] · [[Full adder]] · [[Binary arithmetic]]
