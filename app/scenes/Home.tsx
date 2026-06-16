// MobX 观察者装饰器，用于响应式更新组件
import { observer } from "mobx-react";
// 首页图标
import { HomeIcon } from "outline-icons";
// 国际化翻译钩子
import { useTranslation } from "react-i18next";
// React Router 路由组件
import { Switch, Route } from "react-router-dom";
// styled-components 样式库
import styled from "styled-components";
// 主题样式混合函数
import { s } from "@shared/styles";
// 操作按钮容器组件
import { Action } from "~/components/Actions";
// 空状态占位组件
import Empty from "~/components/Empty";
// 标题组件
import Heading from "~/components/Heading";
// 搜索输入框组件
import InputSearchPage from "~/components/InputSearchPage";
// 语言设置提示组件
import LanguagePrompt from "~/components/LanguagePrompt";
// 分页文档列表组件
import PaginatedDocumentList from "~/components/PaginatedDocumentList";
// 置顶文档展示组件
import PinnedDocuments from "~/components/PinnedDocuments";
// 自动调整高度的容器组件
import { ResizingHeightContainer } from "~/components/ResizingHeightContainer";
// 页面场景布局组件
import Scene from "~/components/Scene";
// 标签页组件
import Tab from "~/components/Tab";
// 标签页容器组件
import Tabs from "~/components/Tabs";
// 获取当前团队的钩子
import useCurrentTeam from "~/hooks/useCurrentTeam";
// 获取当前用户的钩子
import useCurrentUser from "~/hooks/useCurrentUser";
// 获取置顶文档的钩子
import { usePinnedDocuments } from "~/hooks/usePinnedDocuments";
// 权限策略检查钩子
import usePolicy from "~/hooks/usePolicy";
// MobX 状态管理钩子
import useStores from "~/hooks/useStores";
// 新建文档菜单组件
import NewDocumentMenu from "~/menus/NewDocumentMenu";

/**
 * Home 组件 - 应用程序的首页场景
 *
 * 该组件展示用户的主要工作区，包括：
 * - 置顶文档快速访问
 * - 多个文档视图标签页（最近查看、热门、最近更新、我创建的）
 * - 搜索功能
 * - 新建文档操作
 * - 语言设置提示（如果用户未关闭）
 *
 * 使用 MobX observer 包装以实现响应式更新
 */
function Home() {
  // 从 MobX store 中获取文档和 UI 状态
  const { documents, ui } = useStores();
  // 获取当前团队信息
  const team = useCurrentTeam();
  // 获取当前登录用户信息
  const user = useCurrentUser();
  // 获取国际化翻译函数
  const { t } = useTranslation();
  // 提取用户 ID，用于筛选用户创建的文档
  const userId = user?.id;
  // 获取首页的置顶文档列表和数量
  const { pins, count } = usePinnedDocuments("home");
  // 获取当前用户对团队的权限策略
  const can = usePolicy(team);

  return (
    <Scene
      icon={<HomeIcon />}
      title={t("Home")}
      left={
        // 页头左侧：搜索框
        <InputSearchPage source="dashboard" label={t("Search documents")} />
      }
      actions={
        // 页头右侧：新建文档按钮
        <Action>
          <NewDocumentMenu />
        </Action>
      }
    >
      {/* 自动调整高度的容器，用于显示语言提示 */}
      <ResizingHeightContainer>
        {/* 如果用户未关闭语言提示，则显示语言设置提示 */}
        {!ui.languagePromptDismissed && <LanguagePrompt key="language" />}
      </ResizingHeightContainer>

      {/* 页面主标题 */}
      <Heading>{t("Home")}</Heading>

      {/* 置顶文档区域 */}
      <PinnedDocuments
        pins={pins}
        canUpdate={can.update}
        placeholderCount={count}
      />

      {/* 文档列表区域 */}
      <Documents>
        {/* 标签页导航 */}
        <Tabs>
          {/* 最近查看标签页 */}
          <Tab to="/home" exact>
            {t("Recently viewed")}
          </Tab>
          {/* 热门文档标签页 */}
          <Tab to="/home/popular" exact>
            {t("Popular")}
          </Tab>
          {/* 最近更新标签页 */}
          <Tab to="/home/recent" exact>
            {t("Recently updated")}
          </Tab>
          {/* 我创建的文档标签页 */}
          <Tab to="/home/created">{t("Created by me")}</Tab>
        </Tabs>

        {/* 路由切换，根据 URL 显示不同的文档列表 */}
        <Switch>
          {/* 最近更新的文档列表 */}
          <Route path="/home/recent">
            <PaginatedDocumentList
              documents={documents.recentlyUpdated}
              fetch={documents.fetchRecentlyUpdated}
              empty={<Empty>{t("Weird, this shouldn’t ever be empty")}</Empty>}
              showCollection
            />
          </Route>

          {/* 热门文档列表（根据最近活动排序） */}
          <Route path="/home/popular">
            <PaginatedDocumentList
              key="popular"
              documents={documents.popular}
              fetch={documents.fetchPopular}
              empty={
                <Empty>
                  {t("Documents with recent activity will appear here")}
                </Empty>
              }
              showCollection
            />
          </Route>

          {/* 当前用户创建的文档列表 */}
          <Route path="/home/created">
            <PaginatedDocumentList
              key="created"
              documents={documents.createdByUser(userId)}
              fetch={documents.fetchOwned}
              options={{
                userId,
              }}
              empty={
                <Empty>{t("You haven’t created any documents yet")}</Empty>
              }
              showCollection
            />
          </Route>

          {/* 最近查看的文档列表（默认视图） */}
          <Route path="/home">
            <PaginatedDocumentList
              key="recent"
              documents={documents.recentlyViewed}
              fetch={documents.fetchRecentlyViewed}
              empty={
                <Empty>
                  {t(
                    "Documents you’ve recently viewed will be here for easy access"
                  )}
                </Empty>
              }
              showCollection
            />
          </Route>
        </Switch>
      </Documents>
    </Scene>
  );
}

/**
 * Documents 样式组件 - 文档列表容器
 *
 * 提供相对定位和背景色，用于包裹标签页和文档列表
 * 背景色通过主题系统的 s() 函数动态获取
 */
const Documents = styled.div`
  position: relative;
  background: ${s("background")};
`;

// 使用 MobX observer 包装组件，使其能够响应 store 中的状态变化
export default observer(Home);
