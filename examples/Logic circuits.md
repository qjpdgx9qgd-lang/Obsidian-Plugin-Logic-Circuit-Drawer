# Logic circuit examples

Copy this note into your vault to try the diagrams in Reading view and Live Preview. Source mode exposes the data.

## Two inputs and an AND gate

```logic-circuit
{
  "schemaVersion": 1,
  "circuitId": "example-and",
  "nodes": [
    {
      "id": "a",
      "type": "input",
      "position": {
        "x": 40,
        "y": 40
      },
      "label": "A"
    },
    {
      "id": "b",
      "type": "input",
      "position": {
        "x": 40,
        "y": 140
      },
      "label": "B"
    },
    {
      "id": "and",
      "type": "and",
      "position": {
        "x": 220,
        "y": 80
      }
    },
    {
      "id": "y",
      "type": "output",
      "position": {
        "x": 420,
        "y": 80
      },
      "label": "Y"
    }
  ],
  "edges": [
    {
      "id": "a-and",
      "sourceNodeId": "a",
      "sourcePinId": "out",
      "targetNodeId": "and",
      "targetPinId": "in-1"
    },
    {
      "id": "b-and",
      "sourceNodeId": "b",
      "sourcePinId": "out",
      "targetNodeId": "and",
      "targetPinId": "in-2"
    },
    {
      "id": "and-y",
      "sourceNodeId": "and",
      "sourcePinId": "out",
      "targetNodeId": "y",
      "targetPinId": "in-1"
    }
  ],
  "view": {
    "preferredScale": 1
  }
}
```

This paragraph must remain unchanged when editing either diagram.

## Explicit branching

The filled junction sends the same output to Y and Z. Move the gate or junction, delete one branch, or undo an edit.

```logic-circuit
{
  "schemaVersion": 1,
  "circuitId": "example-branch",
  "nodes": [
    {
      "id": "a",
      "type": "input",
      "position": {
        "x": 40,
        "y": 40
      },
      "label": "A"
    },
    {
      "id": "b",
      "type": "input",
      "position": {
        "x": 40,
        "y": 140
      },
      "label": "B"
    },
    {
      "id": "and",
      "type": "and",
      "position": {
        "x": 220,
        "y": 80
      }
    },
    {
      "id": "j",
      "type": "junction",
      "position": {
        "x": 360,
        "y": 110
      }
    },
    {
      "id": "y",
      "type": "output",
      "position": {
        "x": 480,
        "y": 60
      },
      "label": "Y"
    },
    {
      "id": "z",
      "type": "output",
      "position": {
        "x": 480,
        "y": 160
      },
      "label": "Z"
    }
  ],
  "edges": [
    {
      "id": "a-and",
      "sourceNodeId": "a",
      "sourcePinId": "out",
      "targetNodeId": "and",
      "targetPinId": "in-1"
    },
    {
      "id": "b-and",
      "sourceNodeId": "b",
      "sourcePinId": "out",
      "targetNodeId": "and",
      "targetPinId": "in-2"
    },
    {
      "id": "and-j",
      "sourceNodeId": "and",
      "sourcePinId": "out",
      "targetNodeId": "j",
      "targetPinId": "in-1"
    },
    {
      "id": "j-y",
      "sourceNodeId": "j",
      "sourcePinId": "out",
      "targetNodeId": "y",
      "targetPinId": "in-1"
    },
    {
      "id": "j-z",
      "sourceNodeId": "j",
      "sourcePinId": "out",
      "targetNodeId": "z",
      "targetPinId": "in-1"
    }
  ],
  "view": {
    "preferredScale": 1
  }
}
```

Both circuits save independently.

## A reusable full adder as a black box

The square stands in for a circuit drawn elsewhere. It exposes three inputs and two outputs, so it can be wired like a single object.

```logic-circuit
{
  "schemaVersion": 1,
  "circuitId": "example-black-box-full-adder",
  "nodes": [
    { "id": "a", "type": "input", "position": { "x": 40, "y": 64 }, "label": "A" },
    { "id": "b", "type": "input", "position": { "x": 40, "y": 144 }, "label": "B" },
    { "id": "cin", "type": "input", "position": { "x": 40, "y": 224 }, "label": "Cin" },
    { "id": "fa", "type": "blackbox", "position": { "x": 240, "y": 96 }, "label": "FA", "inputCount": 3, "outputCount": 2 },
    { "id": "sum", "type": "output", "position": { "x": 440, "y": 112 }, "label": "Sum" },
    { "id": "cout", "type": "output", "position": { "x": 440, "y": 208 }, "label": "Cout" }
  ],
  "edges": [
    { "id": "a-fa", "sourceNodeId": "a", "sourcePinId": "out", "targetNodeId": "fa", "targetPinId": "in-1" },
    { "id": "b-fa", "sourceNodeId": "b", "sourcePinId": "out", "targetNodeId": "fa", "targetPinId": "in-2" },
    { "id": "cin-fa", "sourceNodeId": "cin", "sourcePinId": "out", "targetNodeId": "fa", "targetPinId": "in-3" },
    { "id": "fa-sum", "sourceNodeId": "fa", "sourcePinId": "out-1", "targetNodeId": "sum", "targetPinId": "in-1" },
    { "id": "fa-cout", "sourceNodeId": "fa", "sourcePinId": "out-2", "targetNodeId": "cout", "targetPinId": "in-1" }
  ],
  "view": {
    "preferredScale": 1
  }
}
```
