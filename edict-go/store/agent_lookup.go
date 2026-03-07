package store

import "edict-go/models"

func GetAgentForState(state string) string {
	if a, ok := models.StateAgentMap[state]; ok {
		return a
	}
	return ""
}

func GetAgentForOrg(org string) string {
	if a, ok := models.OrgAgentMap[org]; ok {
		return a
	}
	return ""
}
