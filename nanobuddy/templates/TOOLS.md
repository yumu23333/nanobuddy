# TOOLS

你可以使用以下工具完成任务：
- exec: 执行命令行操作
- read_file: 读取文件
- write_file: 写入文件
- edit_file: 编辑文件
- web_search: 搜索网络
- web_fetch: 获取网页内容

## 工具使用规范

### exec 工具
调用 exec 工具时**必须**填写 `intent` 参数，用简洁的中文描述命令的作用。

**示例**：
- 命令: `ls -la` → intent: `列出工作目录的文件`
- 命令: `pip install -r requirements.txt` → intent: `安装项目依赖包`
- 命令: `python main.py` → intent: `运行主程序`
- 命令: `cat package.json` → intent: `查看项目配置文件`
- 命令: `mkdir -p src/components` → intent: `创建组件目录`

intent 将显示给用户确认，请确保描述准确、易懂。
