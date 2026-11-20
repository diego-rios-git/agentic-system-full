'use strict';

/**
 * El adaptador del ciclo dirigido por especificación con sus dos formas de
 * cambio: un directorio por cambio (`dir`, la de OpenSpec) o un documento por
 * cambio (`file`, la de ODD). Se prueba la librería directo, sin packs: estas
 * pruebas no dependen de qué packs eligió el proyecto.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sdd = require('../scripts/lib/sdd');

const ODD_PATTERN = '^S\\d+\\.\\s+(.+?)(?::\\s|\\s*$)';

const fileProvider = {
  provider: 'odd',
  changesDir: 'odd/tasks',
  archiveSegment: 'archive',
  docExtension: '.md',
  changeLayout: 'file',
  scenarioRe: new RegExp(ODD_PATTERN),
};

const dirProvider = {
  provider: 'openspec',
  changesDir: 'openspec/changes',
  archiveSegment: 'archive',
  docExtension: '.md',
  changeLayout: 'dir',
  metaFile: '.openspec.yaml',
  scenarioRe: /^#{3,4}\s+Scenario:\s*(.+?)\s*$/,
};

/** Un repositorio temporal fuera del árbol de trabajo; se borra siempre. */
function withRepo(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-sdd-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const DOC = [
  '# Transferencias',
  'rf: RF-2.01',
  '',
  '## Specs',
  'S1. Rechaza un monto mayor al disponible: "no podés transferir más de lo que tenés"',
  'S2. Registra el movimiento en la auditoría',
  '',
  '## Tasks',
  '- [x] T1 (S1) inline · RED→GREEN · abc1234',
  '',
  '## Log',
  'L1 2026-11-03 pedido (textual): > S3. esto no es una spec',
  '',
].join('\n');

describe('changeLayout: file', () => {
  test('lista abiertos y archivados; el documento es su propio archivo de metadatos', () => {
    withRepo(
      {
        'odd/tasks/transferencias.md': DOC,
        'odd/tasks/archive/2026-10-01-login.md': '# Login\n',
        'odd/tasks/notas.txt': 'no es un documento',
        'odd/tasks/borradores/x.md': 'un subdirectorio no es un cambio',
      },
      (repo) => {
        const changes = sdd.listChanges(fileProvider, repo);
        assert.deepEqual(
          changes.map((c) => [c.name, c.archived]),
          [
            ['transferencias', false],
            ['2026-10-01-login', true],
          ],
        );
        for (const c of changes) assert.equal(c.metaPath, c.path, 'los metadatos van en el documento');
      },
    );
  });

  test('lee los escenarios del documento, con el título corto antes de los dos puntos', () => {
    withRepo({ 'odd/tasks/transferencias.md': DOC }, (repo) => {
      const titles = sdd.scenariosOf(fileProvider, repo, 'transferencias').map((s) => s.title);
      assert.deepEqual(titles, ['Rechaza un monto mayor al disponible', 'Registra el movimiento en la auditoría']);
    });
  });

  test('un cambio archivado se lee por su nombre con el segmento de archivo', () => {
    withRepo({ 'odd/tasks/archive/2026-10-01-login.md': 'S1. Bloquea tras tres intentos\n' }, (repo) => {
      const s = sdd.scenariosOf(fileProvider, repo, 'archive/2026-10-01-login');
      assert.equal(s.length, 1);
      assert.equal(s[0].spec, 'odd/tasks/archive/2026-10-01-login.md:1');
    });
  });

  test('un cambio que no existe no tiene escenarios (y no revienta)', () => {
    withRepo({}, (repo) => {
      assert.deepEqual(sdd.scenariosOf(fileProvider, repo, 'no-existe'), []);
      assert.deepEqual(sdd.listChanges(fileProvider, repo), []);
    });
  });

  test('detecta en el diff los documentos tocados, abiertos y archivados', () => {
    withRepo({ 'README.md': 'base\n' }, (repo) => {
      const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
      git('init', '-q', '-b', 'main');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
      git('add', '.');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'readme');
      git('checkout', '-q', '-b', 'feat');
      for (const [rel, text] of Object.entries({
        'odd/tasks/transferencias.md': DOC,
        'odd/tasks/archive/2026-10-01-login.md': '# Login\n',
        'odd/tasks/borradores/x.md': 'no es un cambio\n',
        'src/a.js': 'x\n',
      })) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), text);
      }
      git('add', '.');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cambio');

      assert.deepEqual(sdd.changesTouched(fileProvider, repo, 'main').sort(), [
        'archive/2026-10-01-login',
        'transferencias',
      ]);
    });
  });
});

describe('changeLayout: dir (por defecto) no cambia', () => {
  test('cada directorio es un cambio; el de archivo no cuenta como cambio abierto', () => {
    withRepo(
      {
        'openspec/changes/alta/design.md': '#### Scenario: da de alta\n',
        'openspec/changes/alta/.openspec.yaml': 'rf: RF-1.01\n',
        'openspec/changes/archive/2026-09-01-baja/design.md': '#### Scenario: da de baja\n',
      },
      (repo) => {
        const changes = sdd.listChanges(dirProvider, repo);
        assert.deepEqual(
          changes.map((c) => [c.name, c.archived]),
          [
            ['alta', false],
            ['2026-09-01-baja', true],
          ],
        );
        assert.equal(changes[0].metaPath, path.join(repo, 'openspec/changes/alta/.openspec.yaml'));
        assert.deepEqual(
          sdd.scenariosOf(dirProvider, repo, 'alta').map((s) => s.title),
          ['da de alta'],
        );
      },
    );
  });

  test('un proveedor sin `changeLayout` se lee como `dir`', () => {
    const { changeLayout, ...sinLayout } = dirProvider;
    assert.equal(changeLayout, 'dir');
    withRepo({ 'openspec/changes/alta/design.md': '#### Scenario: da de alta\n' }, (repo) => {
      assert.deepEqual(sdd.listChanges(sinLayout, repo).map((c) => c.name), ['alta']);
    });
  });

  test('el orden es por punto de código, igual en cualquier máquina', () => {
    withRepo(
      Object.fromEntries(['b', 'B-x', 'a-b', 'Z'].map((n) => [`openspec/changes/${n}/design.md`, 'x\n'])),
      (repo) => {
        assert.deepEqual(sdd.listChanges(dirProvider, repo).map((c) => c.name), ['B-x', 'Z', 'a-b', 'b']);
      },
    );
  });
});

describe('changeLayout: file, casos borde', () => {
  const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  const commitAll = (repo, msg) => {
    git(repo, 'add', '.');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg);
  };

  test('un README, un borrador con `_` y una extensión en mayúsculas no son cambios', () => {
    withRepo(
      {
        'odd/tasks/limite.md': 'S1. Algo\n',
        'odd/tasks/README.md': 'cómo usar la carpeta\n',
        'odd/tasks/_borrador.md': 'S1. todavía no\n',
        'odd/tasks/MAYUS.MD': 'S1. Otra\n',
      },
      (repo) => {
        assert.deepEqual(sdd.listChanges(fileProvider, repo).map((c) => c.name), ['limite']);
      },
    );
  });

  test('el diff detecta un documento con tilde en el nombre y descarta lo que no es cambio', () => {
    withRepo({ 'base.txt': 'x\n' }, (repo) => {
      git(repo, 'init', '-q', '-b', 'main');
      commitAll(repo, 'base');
      git(repo, 'checkout', '-q', '-b', 'feat');
      for (const rel of ['odd/tasks/validación.md', 'odd/tasks/README.md', 'odd/tasks/MAYUS.MD']) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), 'S1. Algo\n');
      }
      commitAll(repo, 'cambio');
      assert.deepEqual(sdd.changesTouched(fileProvider, repo, 'main'), ['validación']);
    });
  });

  test('el cambio se encuentra también con extensión o con la ruta desde la raíz', () => {
    withRepo({ 'odd/tasks/v1.2.md': DOC }, (repo) => {
      for (const forma of ['v1.2', 'v1.2.md', 'odd/tasks/v1.2.md', 'odd\\tasks\\v1.2.md']) {
        assert.equal(sdd.scenariosOf(fileProvider, repo, forma).length, 2, forma);
      }
    });
  });
});

describe('providerFor', () => {
  const assets = require('../scripts/lib/asset-roots');

  /** Un pack falso, sin tocar el disco: se reemplaza la lectura de raíces. */
  function withManifest(manifest, fn) {
    const { rootsFor, rawManifest } = assets;
    assets.rootsFor = () => [{ id: 'falso', kind: 'pack', dir: 'ai/packs/falso' }];
    assets.rawManifest = () => manifest;
    try {
      return fn();
    } finally {
      assets.rootsFor = rootsFor;
      assets.rawManifest = rawManifest;
    }
  }

  test('rechaza un `changeLayout` desconocido con un aviso, en vez de leerlo como `dir`', () => {
    withManifest({ sdd: { changesDir: 'odd/tasks', changeLayout: 'files' } }, () => {
      const { provider, problems } = sdd.providerFor({}, null);
      assert.equal(provider, null);
      assert.match(problems.join('\n'), /changeLayout.*"files".*"dir" o "file"/);
    });
  });

  test('sin `changeLayout`, el proveedor queda en `dir`; con `file`, en `file`', () => {
    withManifest({ sdd: { changesDir: 'x' } }, () => {
      assert.equal(sdd.providerFor({}, null).provider.changeLayout, 'dir');
    });
    withManifest({ sdd: { changesDir: 'x', changeLayout: 'file' } }, () => {
      assert.equal(sdd.providerFor({}, null).provider.changeLayout, 'file');
    });
  });
});
