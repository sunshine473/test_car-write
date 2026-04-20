#!/usr/bin/env bash
set -euo pipefail

# 汽车内容自动策展系统
# 用法: ./run.sh [module]
# module: feed, cluster, rank, write, deliver, all

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$PROJECT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."

    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi

    if [ ! -d "node_modules" ]; then
        log_warning "依赖未安装，正在安装..."
        npm install
    fi

    if [ ! -f ".env" ]; then
        log_error ".env 文件不存在，请先配置 API Keys"
        exit 1
    fi

    log_success "依赖检查完成"
}

# 运行模块
run_module() {
    local module=$1
    local module_name=$2

    echo ""
    log_info "运行模块: $module_name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if npm run "$module"; then
        log_success "$module_name 完成"
        return 0
    else
        log_error "$module_name 失败"
        return 1
    fi
}

# 主函数
main() {
    local module="${1:-all}"

    echo "🚗 汽车内容自动策展系统"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    check_dependencies

    case "$module" in
        feed)
            run_module "feed" "模块1: 抓取热点"
            ;;
        cluster)
            run_module "cluster" "模块2: 去重聚类"
            ;;
        rank)
            run_module "rank" "模块3: 筛选排序"
            ;;
        write)
            run_module "write" "模块4: 写文章"
            ;;
        deliver)
            run_module "deliver" "模块5: Telegram推送"
            ;;
        all)
            log_info "运行完整流程（5个模块）"
            echo ""

            run_module "feed" "模块1: 抓取热点" || exit 1
            run_module "cluster" "模块2: 去重聚类" || exit 1
            run_module "rank" "模块3: 筛选排序" || exit 1
            run_module "write" "模块4: 写文章" || exit 1
            run_module "deliver" "模块5: Telegram推送" || exit 1

            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            log_success "所有模块完成！"
            log_info "请查看 Telegram 消息"
            ;;
        *)
            log_error "未知模块: $module"
            echo ""
            echo "用法: $0 [module]"
            echo ""
            echo "可用模块:"
            echo "  feed      - 模块1: 抓取热点"
            echo "  cluster   - 模块2: 去重聚类"
            echo "  rank      - 模块3: 筛选排序"
            echo "  write     - 模块4: 写文章"
            echo "  deliver   - 模块5: Telegram推送"
            echo "  all       - 运行完整流程（默认）"
            exit 1
            ;;
    esac
}

main "$@"
