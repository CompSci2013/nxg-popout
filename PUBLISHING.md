# Publishing to GitLab npm Registry

This document covers how to publish `@halolabs/ngx-popout` to the GitLab npm registry at `gitlab.minilab`, and how consuming projects install it.

## Prerequisites

- A GitLab Personal Access Token (PAT) with `api` scope
- The library built successfully (`npm run build`)

## Publisher Setup

### 1. Create `.npmrc` in the library's project directory

Create `projects/popout/.npmrc`:

```
@halolabs:registry=http://gitlab.minilab/api/v4/projects/107/packages/npm/
//gitlab.minilab/api/v4/projects/107/packages/npm/:_authToken=YOUR_PAT_TOKEN
```

### 2. Add `.npmrc` to `.gitignore`

The `.npmrc` contains your auth token — never commit it.

```bash
echo "projects/popout/.npmrc" >> .gitignore
```

### 3. Build and Publish

```bash
# Build
npm run build

# Copy .npmrc to dist (required — npm publish reads from cwd)
cp projects/popout/.npmrc dist/ngx-popout/

# Publish
cd dist/ngx-popout
npm publish
```

### Version Bumping

Before publishing a new version, update the version in `projects/popout/package.json`:

```bash
cd projects/popout
npm version patch   # 1.0.0 -> 1.0.1
# or
npm version minor   # 1.0.0 -> 1.1.0
```

Then rebuild and publish.

## Consumer Setup

### 1. Create `.npmrc` in your consuming project root

```
@halolabs:registry=http://gitlab.minilab/api/v4/groups/7/-/packages/npm/
//gitlab.minilab/api/v4/groups/7/-/packages/npm/:_authToken=YOUR_PAT_TOKEN
```

This uses the **group-level** registry (group ID 7 = `halo`), which serves all `@halolabs/*` packages from any project in the group.

### 2. Install

```bash
npm install @halolabs/ngx-popout
```

### 3. Use in your Angular module

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

## Verifying on GitLab

After publishing, the package appears at:
- **Project level**: `http://gitlab.minilab/halo/ngx-popout/-/packages`
- **Group level**: `http://gitlab.minilab/groups/halo/-/packages`

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `403 Forbidden` | Invalid or expired PAT | Generate new token with `api` scope |
| `409 Conflict` | Version already exists | Bump version before publishing |
| `404 Not Found` on install | Consumer `.npmrc` missing or wrong group ID | Ensure group-level registry URL with group ID 7 |
| Package installs but types missing | Built without `--configuration production` | Always use `npm run build` (uses production config) |
