package services

import (
	"log"
	"strings"

	"edict-go/models"
	"edict-go/store"
)

// AgentMatcher 负责根据任务需求匹配最合适的智能体
type AgentMatcher struct {
	Agents []models.AgentMeta
}

// NewAgentMatcher 初始化匹配器，加载最新配置
func NewAgentMatcher() *AgentMatcher {
	var cfg models.AgentConfig
	if err := store.ReadJSONFile("agent_config.json", &cfg); err != nil {
		log.Printf("⚠️ AgentMatcher: Failed to load agent_config.json: %v", err)
		return &AgentMatcher{}
	}
	return &AgentMatcher{Agents: cfg.Agents}
}

// Match 寻找最匹配的智能体 ID
func (m *AgentMatcher) Match(requestedRole string, title string) string {
	if len(m.Agents) == 0 {
		return ""
	}

	// 1. 优先匹配明确要求的 RequestedRole
	if requestedRole != "" {
		req := strings.ToLower(requestedRole)
		for _, a := range m.Agents {
			if strings.ToLower(a.Role) == req || strings.Contains(strings.ToLower(a.Label), req) {
				return a.ID
			}
		}
	}

	// 2. 如果没有明确 Role，根据标题语义模糊匹配角色职责 (Duty/Role)
	t := strings.ToLower(title)
	
	// 简单关键词启发式匹配 (后续可扩展为向量匹配)
	keywords := map[string]string{
		"代码": "software_engineer",
		"前端": "agency_engineering_frontend_developer",
		"后端": "agency_engineering_senior_developer",
		"测试": "qa_engineer",
		"文档": "agency_engineering_technical_writer",
		"设计": "agency_engineering_software_architect",
		"数据": "agency_engineering_data_engineer",
		"分析": "data_analyst",
		"安全": "reviewer",
	}

	for kw, agentID := range keywords {
		if strings.Contains(t, kw) {
			// 验证该 Agent 是否存在于配置中
			for _, a := range m.Agents {
				if a.ID == agentID {
					return a.ID
				}
			}
		}
	}

	// 3. 兜底策略：如果还是没找到，分发给系统默认专家池或调度器
	return "" 
}

// GetAvailableAgent 检查智能体是否忙碌并返回可用者 (逻辑待增强)
func (m *AgentMatcher) GetAvailableAgent(agentID string) string {
	// 这里可以加入逻辑：如果 agentID 忙碌，且有同角色的替身，则返回替身
	return agentID
}
