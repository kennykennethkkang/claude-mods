// Copy of pick-cases.json (the file Switchboard reads for its drift test); the test loader takes code files only, so keep both in step.
export default [
 {
  "n": 1,
  "input": {
   "role": "lead",
   "text": "bump the version to 0.21.88 and update the CHANGELOG",
   "ai": "claude"
  },
  "expect": {
   "model": "sonnet",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 2,
  "input": {
   "role": "lead",
   "text": "fix the typo in the README",
   "ai": "claude"
  },
  "expect": {
   "model": "sonnet",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 3,
  "input": {
   "role": "engineer",
   "text": "rename hubState to hub in extension/src/hub/routes.ts",
   "ai": "claude"
  },
  "expect": {
   "model": "haiku",
   "effort": "low",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 4,
  "input": {
   "role": "engineer",
   "text": "add a --model flag to newChatCommand in extension/src/hub/projects.ts with a test in extension/test/projects.test.ts",
   "ai": "claude"
  },
  "expect": {
   "model": "sonnet",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 5,
  "input": {
   "role": "engineer",
   "text": "fix the bug where the usage meter shows 0% after reload in extension/src/hub/hub-service.ts",
   "ai": "claude"
  },
  "expect": {
   "model": "sonnet",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 6,
  "input": {
   "role": "qa",
   "text": "review the diff for the picker change",
   "ai": "claude",
   "files": 2
  },
  "expect": {
   "model": "haiku",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 7,
  "input": {
   "role": "qa",
   "text": "review the auth refresh change",
   "ai": "claude",
   "files": 6
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 8,
  "input": {
   "role": "researcher",
   "text": "find where the effort level is set for new chats",
   "ai": "claude"
  },
  "expect": {
   "model": "haiku",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 9,
  "input": {
   "role": "researcher",
   "text": "research model routing papers and compare RouteLLM with FrugalGPT",
   "ai": "claude"
  },
  "expect": {
   "model": "haiku",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 10,
  "input": {
   "role": "Explore",
   "text": "list every file that imports picker.ts",
   "ai": "claude"
  },
  "expect": {
   "model": "haiku",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 11,
  "input": {
   "role": "designer",
   "text": "redesign the chat cards layout for 380px phones",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 12,
  "input": {
   "role": "designer",
   "text": "tweak the send button color",
   "ai": "claude"
  },
  "expect": {
   "model": "sonnet",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 13,
  "input": {
   "role": "ops",
   "text": "write release notes for 0.21.88",
   "ai": "claude"
  },
  "expect": {
   "model": "haiku",
   "effort": "low",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 14,
  "input": {
   "role": "growth",
   "text": "write a launch post for the phone app",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 15,
  "input": {
   "role": "engineer",
   "text": "the hub panel freezes intermittently when two windows reload; find the root cause and fix it",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 16,
  "input": {
   "role": "engineer",
   "text": "fix the race in chat-wait where two chats write links.json at once",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 17,
  "input": {
   "role": "lead",
   "text": "migrate every hub route to the new auth middleware and update all callers",
   "ai": "claude",
   "unattended": true
  },
  "expect": {
   "model": "opus",
   "effort": "xhigh",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 18,
  "input": {
   "role": "lead",
   "text": "migrate every hub route to the new auth middleware and update all callers",
   "ai": "claude",
   "unattended": true,
   "usage5h": 72
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 19,
  "input": {
   "role": "lead",
   "text": "Make sure switchboard picks model and effort per task with an algorithm. Also make a terminal mod for role popups. Also redesign the terminal for reading. Also see if the terminal can be reached from other devices.",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 20,
  "input": {
   "role": "lead",
   "text": "why does the phone app drop the websocket after 60s idle? explain, don't change code",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": true
  }
 },
 {
  "n": 21,
  "input": {
   "role": "lead",
   "text": "why does the phone app drop the websocket after 60s idle? explain, don't change code",
   "ai": "claude",
   "usage5h": 65
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 22,
  "input": {
   "role": "lead",
   "text": "audit the whole repo for security holes in the shell and network paths",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "xhigh",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 23,
  "input": {
   "role": "lead",
   "text": "audit the whole repo for security holes in the shell and network paths and find the root cause of the intermittent crash",
   "ai": "claude",
   "unattended": true
  },
  "expect": {
   "model": "fable",
   "effort": "max",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 24,
  "input": {
   "role": "lead",
   "text": "audit the whole repo for security holes in the shell and network paths",
   "ai": "claude",
   "unattended": true,
   "usage5h": 80
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 25,
  "input": {
   "role": "engineer",
   "text": "fix the layout bug in web/components/switchboard/chat-cards.tsx",
   "ai": "claude",
   "learned": 1
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 26,
  "input": {
   "role": "engineer",
   "text": "add the effort flag to To-do Start",
   "ai": "claude",
   "sentBack": 2
  },
  "expect": {
   "model": "sonnet",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 27,
  "input": {
   "role": "qa",
   "text": "review the one-line fix in picker.ts",
   "ai": "claude",
   "files": 1
  },
  "expect": {
   "model": "haiku",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 28,
  "input": {
   "role": "qa",
   "text": "review the hub-service state refactor",
   "ai": "claude",
   "files": 14
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 29,
  "input": {
   "role": "lead",
   "text": "Rework the hub across the app:\n- move limits.ts reads into hub-service.ts\n- split routes.ts by area\n- port the phone app to the new hub-types.ts\n- update every test in extension/test/hub.test.ts",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "xhigh",
   "ultracode": true,
   "ultrathink": false
  }
 },
 {
  "n": 30,
  "input": {
   "role": "lead",
   "text": "Rework the hub across the app:\n- move limits.ts reads into hub-service.ts\n- split routes.ts by area\n- port the phone app to the new hub-types.ts\n- update every test in extension/test/hub.test.ts",
   "ai": "claude",
   "usage5h": 61
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 31,
  "input": {
   "role": "lead",
   "text": "fix the typo in the README",
   "ai": "claude",
   "usage5h": 75,
   "explicit": {
    "effort": "xhigh"
   }
  },
  "expect": {
   "model": "sonnet",
   "effort": "xhigh",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 32,
  "input": {
   "role": "engineer",
   "text": "rewrite the scheduler as a state machine and find the root cause of the deadlock in extension/src/hub/todo.ts",
   "ai": "claude",
   "learned": 1
  },
  "expect": {
   "model": "fable",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 33,
  "input": {
   "role": "engineer-codex",
   "text": "implement the scorer in extension/src/hub/picker.ts",
   "ai": "codex"
  },
  "expect": {
   "model": "gpt-5.6-terra",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 34,
  "input": {
   "role": "engineer-codex",
   "text": "fix the flaky reload race across extension/src/hub",
   "ai": "codex"
  },
  "expect": {
   "model": "gpt-6-luna",
   "effort": "xhigh",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 35,
  "input": {
   "role": "engineer-codex",
   "text": "fix the flaky reload race across extension/src/hub",
   "ai": "codex",
   "usage5h": 70
  },
  "expect": {
   "model": "gpt-5.6-terra",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 36,
  "input": {
   "role": "qa-codex",
   "text": "review the picker diff",
   "ai": "codex"
  },
  "expect": {
   "model": "gpt-5.6-luna",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 37,
  "input": {
   "role": "lead",
   "text": "pull me to the page to get that api key and I will paste it in",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 38,
  "input": {
   "role": "lead",
   "text": "seems like it is completely broken so lets just ignore it",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 39,
  "input": {
   "role": "lead",
   "text": "can you pull up all the pages for me to test? also make sure the AWS account is only used for the app deploy",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 40,
  "input": {
   "role": "lead",
   "text": "make an app like the example site for tracking expenses, inventory and items sold. It should be hosted on github so another person can add and adjust items, track prices and sales on a few other sites, and use a clean design with easy to read details on each item. If I get more inventory I should be able to add it without any issues.",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 41,
  "input": {
   "role": "lead",
   "text": "do a deep sweep of the whole UI and revamp the assets, see what could improve the experience, and run an A/B test",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 42,
  "input": {
   "role": "lead",
   "text": "clean up the whole dashboard so the tasks and to-do information are easier to read",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 43,
  "input": {
   "role": "lead",
   "text": "Run indefinitely should be a switch I can select for specific chats so it keeps running and checking for bugs, user problems and hard to use parts. This mode never asks me anything and decides on its own, creating and iterating until the product is built, and stops when I toggle it off or the project is done.",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 44,
  "input": {
   "role": "lead",
   "text": "Tailscale viewing is broken on phone please take a look and fix",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "high",
   "ultracode": false,
   "ultrathink": false
  }
 },
 {
  "n": 45,
  "input": {
   "role": "lead",
   "text": "Is everything here finished?",
   "ai": "claude"
  },
  "expect": {
   "model": "opus",
   "effort": "medium",
   "ultracode": false,
   "ultrathink": false
  }
 }
]
