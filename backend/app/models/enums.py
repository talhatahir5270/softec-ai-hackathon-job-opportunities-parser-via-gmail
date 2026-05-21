from enum import IntEnum, StrEnum


class Degree(StrEnum):
    BS_CS = "BS Computer Science"
    BS_SE = "BS Software Engineering"
    BS_IT = "BS Information Technology"
    BS_DS = "BS Data Science"
    BS_AI = "BS Artificial Intelligence"
    BBA = "BBA"
    MBA = "MBA"
    OTHER = "Other"


class Semester(IntEnum):
    SEM_1 = 1
    SEM_2 = 2
    SEM_3 = 3
    SEM_4 = 4
    SEM_5 = 5
    SEM_6 = 6
    SEM_7 = 7
    SEM_8 = 8
    GRADUATED = 9


class Skill(StrEnum):
    PYTHON = "Python"
    JAVA = "Java"
    CPP = "C++"
    JAVASCRIPT = "JavaScript"
    REACT = "React"
    NODE = "Node.js"
    MACHINE_LEARNING = "Machine Learning"
    DEEP_LEARNING = "Deep Learning"
    DATA_ANALYSIS = "Data Analysis"
    SQL = "SQL"
    UI_UX = "UI/UX Design"
    DEVOPS = "DevOps"
    CLOUD = "Cloud Computing"
    OTHER = "Other"


class Interest(StrEnum):
    AI = "Artificial Intelligence"
    WEB_DEV = "Web Development"
    MOBILE_DEV = "Mobile Development"
    DATA_SCIENCE = "Data Science"
    CYBER_SECURITY = "Cyber Security"
    CLOUD = "Cloud Computing"
    BLOCKCHAIN = "Blockchain"
    GAME_DEV = "Game Development"
    ENTREPRENEURSHIP = "Entrepreneurship"
    RESEARCH = "Research"


class OpportunityType(StrEnum):
    INTERNSHIP = "Internship"
    SCHOLARSHIP = "Scholarship"
    HACKATHON = "Hackathon"
    FELLOWSHIP = "Fellowship"
    JOB = "Job"
    FREELANCE = "Freelance"
    EXCHANGE_PROGRAM = "Exchange Program"
    ADMISSION = "Admission"


class LocationPreference(StrEnum):
    PAKISTAN = "Pakistan"
    REMOTE = "Remote"
    INTERNATIONAL = "International"


class FinancialNeed(StrEnum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"
    NONE = "None"


class Availability(StrEnum):
    IMMEDIATE = "Immediate"
    SUMMER = "Summer"
    WINTER = "Winter"
    FLEXIBLE = "Flexible"


class ExperienceLevel(StrEnum):
    BEGINNER = "Beginner"
    INTERMEDIATE = "Intermediate"
    ADVANCED = "Advanced"
