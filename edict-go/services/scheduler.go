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
	
	// 简单关键词启发式匹配 (参考 agent_config.json 中的 ID)
	keywords := map[string]string{
		"代码": "agency_engineering_senior_developer",
		"前端": "agency_engineering_frontend_developer",
		"后端": "agency_engineering_senior_developer",
		"测试": "agency_testing_api_tester",
		"文档": "agency_engineering_technical_writer",
		"架构": "agency_engineering_software_architect",
		"数据": "agency_engineering_data_engineer",
		"安全": "agency_engineering_security_engineer",
		"运维": "agency_engineering_devops_automator",
	}

	for kw, agentID := range keywords {
		if strings.Contains(t, kw) {
			return agentID
		}
	}

	// 3. 按角色大类匹配 (比如 "产品专家")
	for _, a := range m.Agents {
		if strings.Contains(strings.ToLower(a.Role), t) {
			return a.ID
		}
	}

	return "" 
}

// GetAvailableAgent 检查智能体是否忙碌并返回可用者 (逻辑待增强)
func (m *AgentMatcher) GetAvailableAgent(agentID string) string {
	// 这里可以加入逻辑：如果 agentID 忙碌，且有同角色的替身，则返回替身
	return agentID
}
