# trello

Manage Trello boards, lists, and cards through the Trello REST API using `curl` + `jq`.

## Requirements

- `curl`
- `jq`
- Environment variables:
  - `TRELLO_API_KEY`
  - `TRELLO_TOKEN`

## Setup

1. Create an API key: `https://trello.com/app-key`
2. Generate a token from the same page.
3. Export credentials:

```bash
export TRELLO_API_KEY="your-api-key"
export TRELLO_TOKEN="your-token"
```

## How to use it

Example prompts:

```text
Use trello skill to list my boards and show their IDs.
```

```text
Use trello skill to create a card in list <listId> named "Fix auth bug".
```

```text
Use trello skill to move card <cardId> to list <newListId> and add a comment.
```

## Command examples

List boards:

```bash
curl -s "https://api.trello.com/1/members/me/boards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[] | {name, id}'
```

List lists in a board:

```bash
curl -s "https://api.trello.com/1/boards/{boardId}/lists?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[] | {name, id}'
```

List cards in a list:

```bash
curl -s "https://api.trello.com/1/lists/{listId}/cards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq '.[] | {name, id, desc}'
```

Create a card:

```bash
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" \
  -d "idList={listId}" \
  -d "name=Card Title" \
  -d "desc=Card description"
```

Move a card:

```bash
curl -s -X PUT "https://api.trello.com/1/cards/{cardId}?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" \
  -d "idList={newListId}"
```

Add a comment:

```bash
curl -s -X POST "https://api.trello.com/1/cards/{cardId}/actions/comments?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" \
  -d "text=Your comment here"
```

Archive a card:

```bash
curl -s -X PUT "https://api.trello.com/1/cards/{cardId}?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" \
  -d "closed=true"
```

## Notes

- IDs can be discovered from board/list/card URLs or from list commands above.
- API key and token grant account access. Keep them private.
- `skills/trello/SKILL.md` contains the same operational commands plus metadata.
