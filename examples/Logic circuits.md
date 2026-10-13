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
