<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logos/outline-logo-dark.png" height="29">
    <source media="(prefers-color-scheme: light)" srcset="./public/logos/outline-logo-light.png" height="29">
    <img src="./public/logos/outline-logo-light.png" height="29" alt="Outline" />
  </picture>
</p>
<p align="center">
  <i>一个基于 React 和 Node.js 构建的、为团队打造的快速、协作式知识库。<br/>在 <a href="https://www.getoutline.com">www.getoutline.com</a> 体验我们托管的 Outline 服务。</i>
  <br/>
  <img width="1640" alt="screenshot" src="https://user-images.githubusercontent.com/380914/110356468-26374600-7fef-11eb-9f6a-f2cc2c8c6590.png">
</p>
<p align="center">
  <a href="http://www.typescriptlang.org" rel="nofollow"><img src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg" alt="TypeScript"></a>
  <a href="https://github.com/styled-components/styled-components"><img src="https://img.shields.io/badge/style-%F0%9F%92%85%20styled--components-orange.svg" alt="Styled Components"></a>
  <a href="https://translate.getoutline.com/project/outline" alt="Localized"><img src="https://badges.crowdin.net/outline/localized.svg"></a>
</p>

本仓库是驱动 [**Outline**](https://www.getoutline.com) 及其所有关联服务的源代码。如果你只是想使用 Outline，并不需要运行这份代码——我们在 [getoutline.com](https://www.getoutline.com) 提供托管版本。你也可以在[使用指南](https://docs.getoutline.com/s/guide)中找到 Outline 的使用文档。

如果你希望自己部署一套 Outline，或者想为开发做贡献，那么你来对地方了。

# 安装

请参阅[文档](https://docs.getoutline.com/s/hosting/)以在生产环境中部署你自己的 Outline。

可用的容器镜像：
* [![Container Image Release](https://img.shields.io/docker/v/outlinewiki/outline?sort=semver&label=Latest%20release)](https://hub.docker.com/r/outlinewiki/outline)
* [![Container Image Nightly](https://img.shields.io/docker/v/outlinewiki/outline?sort=date&label=Latest%20development%20version)](https://hub.docker.com/r/outlinewiki/outline)

如果你对文档有任何疑问或改进建议，请在 [GitHub discussions](https://github.com/outline/outline/discussions) 中开一个讨论帖。

# 贡献

> **注意：** 请不要提交由 AI 生成的 pull request。我们收到大量来自 Claude、ChatGPT、Copilot 等 AI 工具批量生成的低质量 PR，提交者往往对代码库并不熟悉。这些 PR 几乎从未被合并过，并且会浪费维护者的评审时间。如果你想贡献代码，请花时间理解代码库，并认真思考你的改动。

在提交 pull request 之前，你**必须**先在 [GitHub](https://www.github.com/outline/outline/issues) 上通过创建或评论一个 issue 与核心团队进行讨论——我们也很欢迎你到 [discussions](https://www.github.com/outline/outline/discussions) 与我们交流。这样可以确保在动手写代码之前双方已就方案达成共识，并且你已经阅读过这些说明。这会大大提高你的代码被接受的概率。

如果你在寻找上手方式，下面是一些可以帮助我们改进 Outline 的方向：

- [翻译](docs/TRANSLATION.md)为其他语言
- 带有 [`good first issue`](https://github.com/outline/outline/labels/good%20first%20issue) 标签的 issue
- 服务端和前端性能改进
- 开发者体验和文档
- GitHub 上列出的 Bug、质量修复及其他问题

# 开发

如果你想为 Outline 提交改动、修复或改进，这里有一份简短的[开发环境搭建指南](https://docs.getoutline.com/s/hosting/doc/local-development-5hEhFRXow7)。

## 架构

如果你有兴趣为 Outline 做贡献，或想进一步了解 Outline 代码库，请先阅读[架构文档](docs/ARCHITECTURE.md)，从高层视角了解整个应用是如何组织的。

## 调试

在开发环境中，Outline 会向控制台输出按类别前缀区分的简单日志。在生产环境中，它输出 JSON 格式日志，便于被你常用的日志采集管道解析。

HTTP 日志默认是关闭的，可以通过设置 `DEBUG=http` 环境变量来开启。可以通过 `DEBUG=*` 开启所有类别的日志，也可以针对特定类别，例如 `DEBUG=database` 并配合 `LOG_LEVEL=debug`，或使用 `LOG_LEVEL=silly` 获取最详细的日志输出。

## 测试

我们的目标是为应用的关键部分提供足够的测试覆盖率，而不是追求 100% 的单元测试覆盖率。所有 API 端点和任何与认证相关的代码都应该有充分的测试。

要添加新的测试，请使用 [Vitest](https://vitest.dev/) 编写，并在被测试代码旁边新建一个 `.test.ts` 后缀的文件。

```shell
# 运行所有测试
make test

# 以 watch 模式运行后端测试
make watch
```

通过 `make test` 创建好测试数据库后，就可以单独用 vitest 运行前端和后端测试了：

```shell
# 运行后端测试
yarn test:server

# 以 watch 模式运行指定的后端测试
yarn test path/to/file.test.ts --watch

# 运行前端测试
yarn test:app
```

## 数据库迁移

我们使用 Sequelize 来创建和运行迁移，例如：

```shell
yarn db:create-migration --name my-migration
yarn db:migrate
yarn db:rollback
```

或者，在测试数据库上运行迁移：

```shell
yarn db:migrate --env test
```

# 项目活跃度

![Alt](https://repobeats.axiom.co/api/embed/ff2e4e6918afff1acf9deb72d1ba6b071d586178.svg "Repobeats analytics image")

# 许可证

Outline 使用 [BSL 1.1 许可证](LICENSE)。
