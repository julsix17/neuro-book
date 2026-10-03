import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it} from "vitest";
import {
    hashFile,
    hashRuntimeArtifactDependency,
    PROFILE_COMPILED_DIR_NAME,
    validateProfileArtifact,
    type ProfileArtifactManifestItem,
    type ProfileArtifactPathContext,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {
    validateVariableDefinitionArtifact,
    VARIABLE_DEFINITION_COMPILED_DIR,
    type VariableDefinitionManifestItem,
} from "nbook/server/agent/variables/definition-artifact";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";

/** Product 构建写进 manifest 的依赖；Source Dev 上下文里不存在 `.output` 逻辑根。 */
const PRODUCT_ONLY_DEPENDENCY = ".output/server/authoring/tsconfig.json";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function createRoot(): Promise<string> {
    await mkdir(testHostPath(), {recursive: true});
    const root = await mkdtemp(testHostPath("nbook-artifact-dependency-"));
    roots.push(root);
    return root;
}

/** 仅把 application root 映射为空逻辑根的 Source 编译上下文。 */
function sourcePathContext(applicationRoot: string): ProfileArtifactPathContext {
    return {
        compilerContext: {productRuntime: false} as RuntimeArtifactCompilerContext,
        mappings: [{physicalRoot: applicationRoot, logicalRoot: ""}],
        rootLabel: "test",
    };
}

/** 写入源码与已编译 artifact，返回与之 hash 一致的 manifest 公共字段。 */
async function writeCompiledPair(root: string, compiledDirName: string, fileName: string, artifactFileName: string) {
    await writeFile(join(root, fileName), "export default {};\n");
    await mkdir(join(root, compiledDirName), {recursive: true});
    await writeFile(join(root, compiledDirName, artifactFileName), "export default {};\n");
    const source = await hashFile(join(root, fileName));
    const artifact = await hashFile(join(root, compiledDirName, artifactFileName));
    return {
        fileName,
        sourceSha256: source.sha256,
        sourceBytes: source.bytes,
        dependencyHash: "",
        artifactFileName,
        artifactSha256: artifact.sha256,
        artifactBytes: artifact.bytes,
        dependencies: [{path: PRODUCT_ONLY_DEPENDENCY, sha256: "0".repeat(64), bytes: 1}],
    };
}

describe("runtime artifact 依赖新鲜度", () => {
    it("依赖逻辑根不属于当前运行时或文件缺失时返回 null，存在时返回 hash", async () => {
        const applicationRoot = await createRoot();
        const context = sourcePathContext(applicationRoot);
        await writeFile(join(applicationRoot, "tsconfig.json"), "{}\n");

        await expect(hashRuntimeArtifactDependency(PRODUCT_ONLY_DEPENDENCY, context)).resolves.toBeNull();
        await expect(hashRuntimeArtifactDependency("missing/tsconfig.json", context)).resolves.toBeNull();
        await expect(hashRuntimeArtifactDependency("tsconfig.json", context))
            .resolves.toEqual(await hashFile(join(applicationRoot, "tsconfig.json")));
    });

    it("Profile manifest 带 Product 依赖时判为 dependency_changed 而不是抛错", async () => {
        const root = await createRoot();
        const item: ProfileArtifactManifestItem = {
            ...await writeCompiledPair(root, PROFILE_COMPILED_DIR_NAME, "writer.profile.tsx", "writer.mjs"),
            profileKey: "writer",
        };

        const validation = await validateProfileArtifact(root, item, sourcePathContext(root));

        expect(validation.fresh).toBe(false);
        expect(validation.reason).toBe("dependency_changed");
        expect(validation.dependency).toMatchObject({path: PRODUCT_ONLY_DEPENDENCY, actual: null});
    });

    it("Variable definition manifest 带 Product 依赖时判为 dependency_changed 而不是抛错", async () => {
        const root = await createRoot();
        const item: VariableDefinitionManifestItem = {
            ...await writeCompiledPair(root, VARIABLE_DEFINITION_COMPILED_DIR, "story.variable.ts", "story.mjs"),
            registeredPaths: [],
        };

        const validation = await validateVariableDefinitionArtifact(root, item, sourcePathContext(root));

        expect(validation.fresh).toBe(false);
        expect(validation.reason).toBe("dependency_changed");
        expect(validation.dependency).toMatchObject({path: PRODUCT_ONLY_DEPENDENCY, actual: null});
    });
});
