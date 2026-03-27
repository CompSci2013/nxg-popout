# Publishing to GitLab npm Registry

This document covers how to publish `@halolabs/ngx-popout` to the GitLab npm registry at `gitlab.minilab`, and how consuming projects install it.

## Prerequisites

- A GitLab Personal Access Token (PAT) with `api` scope
- The library built successfully (`npm run build`)

## Step 1: Verify the Package Registry is Available

```bash
# Check your GitLab version
curl -s -H "PRIVATE-TOKEN: <your-token>" "http://gitlab.minilab/api/v4/version"

# Check packages are enabled on this project
curl -s -H "PRIVATE-TOKEN: <your-token>" \
  "http://gitlab.minilab/api/v4/projects/107" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['packages_enabled'])"
```

If `packages_enabled` is `false`, enable it in Project Settings > General > Visibility > Package Registry.

## Step 2: Configure npm Authentication

Create `projects/popout/.npmrc`:

```
@halolabs:registry=http://gitlab.minilab/api/v4/projects/107/packages/npm/
//gitlab.minilab/api/v4/projects/107/packages/npm/:_authToken=YOUR_PAT_TOKEN
```

**Important:** This file contains your auth token — it is already in `.gitignore`. If starting fresh:

```bash
echo "projects/popout/.npmrc" >> .gitignore
```

## Step 3: Build the Library

```bash
npm run build
```

This produces the publishable package in `dist/ngx-popout/`.

### Verify the Package Contents

Before publishing, inspect what will be included:

```bash
cd dist/ngx-popout
npm pack --dry-run
```

You should see FESM bundles, type declarations, and the package.json.

## Step 4: Publish

Copy the `.npmrc` into the dist directory and publish:

```bash
cp projects/popout/.npmrc dist/ngx-popout/
cd dist/ngx-popout
npm publish
```

You should see:
```
+ @halolabs/ngx-popout@1.0.0
```

## Step 5: Verify on GitLab

Navigate to your GitLab project > Packages & Registries > Package Registry, or:

- **Project level**: `http://gitlab.minilab/halo/ngx-popout/-/packages`
- **Group level**: `http://gitlab.minilab/groups/halo/-/packages`

Or verify via API:

```bash
curl -s -H "PRIVATE-TOKEN: <your-token>" \
  "http://gitlab.minilab/api/v4/projects/107/packages" \
  | python3 -m json.tool
```

## Publishing Updates

To publish a new version:

1. Update the version in `projects/popout/package.json`:
   ```bash
   cd projects/popout
   npm version patch   # 1.0.0 -> 1.0.1
   # or
   npm version minor   # 1.0.0 -> 1.1.0
   ```
2. Rebuild: `npm run build`
3. Copy `.npmrc` and publish:
   ```bash
   cp projects/popout/.npmrc dist/ngx-popout/
   cd dist/ngx-popout
   npm publish
   ```

npm will reject duplicate versions — always increment before publishing.

## Consumer Setup

### 1. Create `.npmrc` in your consuming project root

```
@halolabs:registry=http://gitlab.minilab/api/v4/groups/7/-/packages/npm/
//gitlab.minilab/api/v4/groups/7/-/packages/npm/:_authToken=YOUR_PAT_TOKEN
```

This uses the **group-level** registry (group ID 7 = `halo`), which serves all `@halolabs/*` packages from any project in the group. Add `.npmrc` to your `.gitignore` if it contains tokens.

### 2. Install

```bash
npm install @halolabs/ngx-popout
```

### 3. Peer Dependencies

The library requires these (your Angular 14 project likely already has them):

| Package | Version |
|---------|---------|
| `@angular/common` | ^14.2.0 |
| `@angular/core` | ^14.2.0 |
| `@angular/cdk` | ^14.2.0 |
| `rxjs` | ^7.0.0 |

If you don't have Angular CDK:
```bash
npm install @angular/cdk@^14.2.0
```

### 4. Use in your Angular module

```typescript
import { PopoutModule } from '@halolabs/ngx-popout';
import { PopOutManagerService, PopOutContextService } from '@halolabs/ngx-popout';

@NgModule({
  imports: [PopoutModule],
  providers: [PopOutManagerService]
})
export class MyModule {}
```

Components in pop-out windows can optionally inject `PopOutContextService` to detect they're in a pop-out and wait for the environment to be ready:

```typescript
constructor(@Optional() private popOutContext: PopOutContextService) {
  if (this.popOutContext) {
    this.popOutContext.ready$.subscribe(() => {
      // Re-initialize DOM-dependent libraries (e.g. Plotly)
    });
  }
}
```

### 5. Verify installation

```bash
npm ls @halolabs/ngx-popout
```

### Updating

When a new version is published:

```bash
npm update @halolabs/ngx-popout
```

Or install a specific version:

```bash
npm install @halolabs/ngx-popout@1.1.0
```

## Registry URL Reference

| Scope | URL |
|-------|-----|
| Project-level (publish) | `http://gitlab.minilab/api/v4/projects/107/packages/npm/` |
| Group-level (consume) | `http://gitlab.minilab/api/v4/groups/7/-/packages/npm/` |

Group-level URLs let consumers install any `@halolabs/*` package from the halo group with a single registry entry.

## Finding Project IDs and Group IDs

The registry URLs require numeric IDs. Here's how to look them up.

### Find a Project ID

**Via the GitLab UI:** Open the project page — the ID is shown below the project name on the main page.

**Via the API — by path:**

```bash
curl -s -H "PRIVATE-TOKEN: <your-token>" \
  "http://gitlab.minilab/api/v4/projects?search=ngx-popout" \
  | python3 -c "import sys,json; [print(f'{p[\"id\"]}: {p[\"path_with_namespace\"]}') for p in json.load(sys.stdin)]"
```

**Via the API — exact path lookup:**

```bash
curl -s -H "PRIVATE-TOKEN: <your-token>" \
  "http://gitlab.minilab/api/v4/projects/halo%2Fngx-popout" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'ID: {d[\"id\"]}, Path: {d[\"path_with_namespace\"]}')"
```

The `%2F` is a URL-encoded `/`. So `halo/ngx-popout` becomes `halo%2Fngx-popout`.

### Find a Group ID

**Via the GitLab UI:** Open the group page — the ID is shown in the group settings or on the main group page.

**Via the API:**

```bash
curl -s -H "PRIVATE-TOKEN: <your-token>" \
  "http://gitlab.minilab/api/v4/groups?search=halo" \
  | python3 -c "import sys,json; [print(f'{g[\"id\"]}: {g[\"full_path\"]}') for g in json.load(sys.stdin)]"
```

### List All Projects in a Group

To see every project (and its ID) within a group:

```bash
curl -s -H "PRIVATE-TOKEN: <your-token>" \
  "http://gitlab.minilab/api/v4/groups/7/projects?per_page=100" \
  | python3 -c "import sys,json; [print(f'{p[\"id\"]:>4}: {p[\"path\"]}') for p in json.load(sys.stdin)]"
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `403 Forbidden` | Invalid or expired PAT | Generate new token with `api` scope |
| `409 Conflict` | Version already exists | Bump version before publishing |
| `404 Not Found` on install | Consumer `.npmrc` missing or wrong group ID | Ensure group-level registry URL with group ID 7 |
| Package installs but types missing | Built without `--configuration production` | Always use `npm run build` (uses production config) |
